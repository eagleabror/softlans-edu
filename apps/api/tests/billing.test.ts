import { TuitionRun } from "../src/tuition-run-model.js";
import { generateTuitionMonth, runTuitionBatch } from "../src/tuition-service.js";
import { Schedule } from "../src/schedule-models.js";
import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { createApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import { connectDatabase } from "../src/db.js";
import { ensureIndexes, Student, Tenant, User } from "../src/models.js";
import { Group, Membership } from "../src/group-models.js";
import {
  Charge,
  Payment,
  PaymentReversal,
  ChargeAdjustment,
} from "../src/billing-models.js";
import { createSession } from "../src/security.js";
import { currentBillingMonth, monthBounds } from "../src/billing-validation.js";
const origin = "http://localhost:5173";
const config = parseConfig({
  NODE_ENV: "test",
  APP_ORIGIN: origin,
  JWT_SECRET: randomBytes(48).toString("hex"),
  MONGODB_URI: "mongodb://localhost/test",
});
const app = createApp(config);
let repl: MongoMemoryReplSet,
  tenant: mongoose.Types.ObjectId,
  otherTenant: mongoose.Types.ObjectId;
let owner: string,
  admin: string,
  teacher: string,
  platform: string,
  other: string,
  studentId: string,
  groupId: string;
async function actor(
  role: "business_owner" | "admin" | "teacher" | "super_admin",
  tenantId: mongoose.Types.ObjectId | null,
) {
  const u = await User.create({
    role,
    tenantId,
    name: "Sinov",
    email: `${new mongoose.Types.ObjectId()}@example.test`,
    passwordHash: "unused",
  });
  return `softlans_session=${await createSession(u, config)}`;
}
const get = (path: string, cookie = owner) =>
  request(app).get(`/api${path}`).set("Cookie", cookie);
const post = (path: string, body: object, cookie = owner) =>
  request(app)
    .post(`/api${path}`)
    .set("Cookie", cookie)
    .set("Origin", origin)
    .send(body);
const patch = (path: string, body: object, cookie = owner) =>
  request(app)
    .patch(`/api${path}`)
    .set("Cookie", cookie)
    .set("Origin", origin)
    .send(body);
const generate = (month = "2025-02", cookie = owner) =>
  post("/billing/charges/generate", { month, confirmed: true }, cookie);
async function charge() {
  expect((await generate()).status).toBe(200);
  return (await get("/billing/charges")).body.charges[0].id as string;
}
const payment = (chargeId: string, amount = 100, extra = {}) => ({
  chargeId,
  amount,
  method: "cash",
  paidAt: "2025-02-10T12:00:00+05:00",
  idempotencyKey: randomUUID(),
  confirmed: true,
  ...extra,
});
const adjustment = (extra = {}) => ({
  originalAmount: 1000,
  discountAmount: 0,
  reason: "Sinov tuzatish",
  ...extra,
});
beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: "7.0.24" },
  });
  await connectDatabase(repl.getUri("billing"));
  await ensureIndexes();
});
afterAll(async () => {
  await mongoose.disconnect();
  await repl?.stop();
});
beforeEach(async () => {
  await Promise.all([
    TuitionRun.deleteMany({}),
    Schedule.deleteMany({}),
    Charge.deleteMany({}),
    Payment.deleteMany({}),
    PaymentReversal.deleteMany({}),
    ChargeAdjustment.deleteMany({}),
    Membership.deleteMany({}),
    Group.deleteMany({}),
    Student.deleteMany({}),
    User.deleteMany({}),
    Tenant.deleteMany({}),
  ]);
  tenant = (await Tenant.create({ name: "Sinov A" }))._id;
  otherTenant = (await Tenant.create({ name: "Sinov B" }))._id;
  owner = await actor("business_owner", tenant);
  admin = await actor("admin", tenant);
  teacher = await actor("teacher", tenant);
  platform = await actor("super_admin", null);
  other = await actor("business_owner", otherTenant);
  const u = (await User.findOne({ tenantId: tenant, role: "business_owner" }))!;
  studentId = (
    await Student.create({
      tenantId: tenant,
      firstName: "Sinov",
      lastName: "Oquvchi",
      createdBy: u._id,
      enrollmentDate: "2025-01-01",
    })
  ).id;
  groupId = (
    await Group.create({
      tenantId: tenant,
      name: "Sinov",
      courseName: "Fan",
      teacherId: u._id,
      capacity: 10,
      monthlyFee: 1000,
      startDate: "2025-01-01",
    })
  ).id;
  await Membership.create({
    tenantId: tenant,
    groupId,
    studentId,
    enrolledAt: "2025-01-01",
  });
  await Schedule.create({
    tenantId: tenant,
    groupId,
    teacherId: u._id,
    classroomId: new mongoose.Types.ObjectId(),
    dayOfWeek: 1,
    startTime: "10:00",
    endTime: "11:00",
  });
});
describe("monthly billing and immutable manual payments", () => {
  it("generates confirmed tenant-scoped repeatable bills, including concurrent generation and multiple groups", async () => {
    expect(
      (await post("/billing/charges/generate", { month: "2025-02" })).status,
    ).toBe(400);
    const g = await Group.create({
      tenantId: tenant,
      name: "Ikki",
      courseName: "Fan",
      teacherId: new mongoose.Types.ObjectId(),
      capacity: 10,
      monthlyFee: 2000,
      startDate: "2025-01-01",
    });
    await Schedule.create({
      tenantId: tenant,
      groupId: g._id,
      teacherId: g.teacherId,
      classroomId: new mongoose.Types.ObjectId(),
      dayOfWeek: 1,
      startTime: "10:00",
      endTime: "11:00",
    });
    await Membership.create({
      tenantId: tenant,
      groupId: g._id,
      studentId,
      enrolledAt: "2025-01-01",
    });
    const results = await Promise.all([generate(), generate()]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(await Charge.countDocuments({})).toBe(2);
    expect((await generate()).body.created).toBe(0);
    expect(
      (await get("/billing/summary?month=2025-02")).body.billedAmount,
    ).toBe(3000);
    const c = await Charge.findOne({ groupId });
    expect(c!.dueDate.toISOString()).toBe("2025-02-10T18:59:59.999Z");
    await expect(
      Charge.create({ ...c!.toObject(), _id: new mongoose.Types.ObjectId() }),
    ).rejects.toMatchObject({ code: 11000 });
  });
  it("uses effective local month boundaries and excludes future/removed/archived/paused records", async () => {
    await Membership.deleteMany({});
    await Membership.create({
      tenantId: tenant,
      groupId,
      studentId,
      enrolledAt: new Date("2025-02-28T19:00:00Z"),
    });
    expect((await generate()).body.created).toBe(0);
    expect((await generate("2025-03")).body.created).toBe(1);
    await Membership.updateMany({}, { status: "removed" });
    expect((await generate("2025-04")).body.created).toBe(0);
    await Membership.updateMany({}, { status: "active" });
    await Student.updateMany({}, { status: "archived" });
    expect((await generate("2025-04")).body.created).toBe(0);
    await Student.updateMany({}, { status: "active" });
    await Group.updateMany({}, { status: "archived" });
    expect((await generate("2025-04")).body.created).toBe(0);
    await Group.updateMany({}, { status: "paused" });
    expect((await generate("2025-04")).body.created).toBe(0);
    expect(currentBillingMonth(new Date("2025-12-31T19:00:00Z"))).toBe(
      "2026-01",
    );
    expect(monthBounds("2024-02").end.toISOString()).toBe(
      "2024-02-29T19:00:00.000Z",
    );
    expect(monthBounds("2025-12").end.toISOString()).toBe(
      "2025-12-31T19:00:00.000Z",
    );
  });
  it("handles partial/full payments, rejects overpayments, and never modifies payments on reversal", async () => {
    const id = await charge();
    const first = await post("/billing/payments", payment(id, 400), admin);
    expect(first.status).toBe(201);
    let c = (await get(`/billing/charges/${id}`)).body.charge;
    expect(c).toMatchObject({
      paidAmount: 400,
      remainingAmount: 600,
      status: "partial",
    });
    expect((await post("/billing/payments", payment(id, 601))).status).toBe(
      409,
    );
    expect((await post("/billing/payments", payment(id, 600))).status).toBe(
      201,
    );
    expect((await get(`/billing/charges/${id}`)).body.charge.status).toBe(
      "paid",
    );
    const before = (await Payment.findById(first.body.payment.id))!.toObject();
    expect(
      (
        await post(
          `/billing/payments/${first.body.payment.id}/reverse`,
          { reason: "Xato qayd", confirmed: true },
          admin,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await post(`/billing/payments/${first.body.payment.id}/reverse`, {
          reason: "",
          confirmed: true,
        })
      ).status,
    ).toBe(400);
    const r = await post(`/billing/payments/${first.body.payment.id}/reverse`, {
      reason: "Xato qayd",
      confirmed: true,
    });
    expect(r.status).toBe(200);
    expect((await Payment.findById(first.body.payment.id))!.toObject()).toEqual(
      before,
    );
    expect((await get(`/billing/charges/${id}`)).body.charge).toMatchObject({
      paidAmount: 600,
      remainingAmount: 400,
      status: "partial",
    });
    expect(await PaymentReversal.countDocuments({})).toBe(1);
    expect(
      (
        await post(`/billing/payments/${first.body.payment.id}/reverse`, {
          reason: "Xato qayd",
          confirmed: true,
        })
      ).status,
    ).toBe(200);
    expect(
      (await get(`/billing/students/${studentId}/history`)).body.payments.find(
        (p: { id: string }) => p.id === first.body.payment.id,
      ).reversal.reason,
    ).toBe("Xato qayd");
    expect(
      (
        await request(app)
          .delete(`/api/billing/payments/${first.body.payment.id}`)
          .set("Cookie", owner)
          .set("Origin", origin)
          .send({})
      ).status,
    ).toBe(404);
  });
  it("serializes concurrent overpayments, duplicate submissions, and reversals", async () => {
    const id = await charge();
    const results = await Promise.all([
      post("/billing/payments", payment(id, 700)),
      post("/billing/payments", payment(id, 700)),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await Payment.countDocuments({})).toBe(1);
    const p = (await Payment.findOne({}))!;
    const reversed = await Promise.all([
      post(`/billing/payments/${p.id}/reverse`, {
        reason: "Sinov qaytarish",
        confirmed: true,
      }),
      post(`/billing/payments/${p.id}/reverse`, {
        reason: "Sinov qaytarish",
        confirmed: true,
      }),
    ]);
    expect(reversed.map((r) => r.status)).toEqual([200, 200]);
    const input = payment(id, 1000);
    const duplicates = await Promise.all([
      post("/billing/payments", input),
      post("/billing/payments", input),
    ]);
    expect(duplicates.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(duplicates[0].body.payment.id).toBe(duplicates[1].body.payment.id);
    expect(
      (await post("/billing/payments", { ...input, amount: 999 })).status,
    ).toBe(409);
    expect((await get(`/billing/charges/${id}`)).body.charge.paidAmount).toBe(
      1000,
    );
  });
  it("rejects invalid amounts, unknown fields, spoofed actor/tenant and future timestamps", async () => {
    const id = await charge();
    for (const amount of [0, -1, 0.1, "100", 1e16, null])
      expect(
        (await post("/billing/payments", payment(id, amount as number))).status,
      ).toBe(400);
    for (const extra of [
      { tenantId: otherTenant },
      { recordedBy: new mongoose.Types.ObjectId() },
      { method: "payme" },
      { idempotencyKey: "bad" },
      { confirmed: false },
      { paidAt: "2025-02-10" },
    ])
      expect(
        (await post("/billing/payments", payment(id, 100, extra))).status,
      ).toBe(400);
    expect(
      (
        await post(
          "/billing/payments",
          payment(id, 100, { paidAt: "2199-01-01T00:00:00Z" }),
        )
      ).status,
    ).toBe(409);
    expect(await Payment.countDocuments({})).toBe(0);
  });
  it("enforces tenant isolation, IDOR, authentication, CSRF and financial roles on all endpoints", async () => {
    const id = await charge();
    const p = (await post("/billing/payments", payment(id))).body.payment;
    for (const cookie of [teacher, platform]) {
      for (const path of [
        "/billing/charges",
        `/billing/charges/${id}`,
        "/billing/payments",
        `/billing/students/${studentId}/history`,
        "/billing/summary",
      ])
        expect((await get(path, cookie)).status).toBe(403);
      expect((await generate("2025-02", cookie)).status).toBe(403);
      expect(
        (await post("/billing/payments", payment(id), cookie)).status,
      ).toBe(403);
      expect(
        (
          await post(
            `/billing/payments/${p.id}/reverse`,
            { reason: "Xato", confirmed: true },
            cookie,
          )
        ).status,
      ).toBe(403);
    }
    expect((await get(`/billing/charges/${id}`, other)).status).toBe(404);
    expect(
      (await get(`/billing/students/${studentId}/history`, other)).status,
    ).toBe(404);
    expect((await post("/billing/payments", payment(id), other)).status).toBe(
      404,
    );
    expect(
      (
        await post(
          `/billing/payments/${p.id}/reverse`,
          { reason: "Xato", confirmed: true },
          other,
        )
      ).status,
    ).toBe(404);
    expect(
      (await patch(`/billing/charges/${id}`, adjustment(), other)).status,
    ).toBe(404);
    expect((await get("/billing/charges", other)).body.total).toBe(0);
    expect((await get("/billing/payments", other)).body.total).toBe(0);
    expect(
      (await get("/billing/summary?month=2025-02", other)).body.receivedAmount,
    ).toBe(0);
    expect((await request(app).get("/api/billing/charges")).status).toBe(401);
    expect(
      (
        await request(app)
          .post("/api/billing/payments")
          .set("Cookie", owner)
          .send(payment(id))
      ).status,
    ).toBe(403);
  });
  it("audits owner adjustments, prevents reducing below payments and excludes cancelled charges", async () => {
    const id = await charge();
    expect(
      (await patch(`/billing/charges/${id}`, adjustment(), admin)).status,
    ).toBe(403);
    expect(
      (
        await patch(
          `/billing/charges/${id}`,
          adjustment({ discountAmount: 200 }),
        )
      ).status,
    ).toBe(200);
    expect(await ChargeAdjustment.countDocuments({})).toBe(1);
    expect((await ChargeAdjustment.findOne({}))!.before.finalAmount).toBe(1000);
    await post("/billing/payments", payment(id, 800));
    expect(
      (
        await patch(
          `/billing/charges/${id}`,
          adjustment({ discountAmount: 300 }),
        )
      ).status,
    ).toBe(409);
    expect(
      (await patch(`/billing/charges/${id}`, adjustment({ cancelled: true })))
        .status,
    ).toBe(409);
    const p = (await Payment.findOne({}))!;
    await post(`/billing/payments/${p.id}/reverse`, {
      reason: "Xato tolov",
      confirmed: true,
    });
    expect(
      (await patch(`/billing/charges/${id}`, adjustment({ cancelled: true })))
        .status,
    ).toBe(200);
    expect((await post("/billing/payments", payment(id))).status).toBe(404);
    expect((await get("/billing/charges?status=cancelled")).body.total).toBe(1);
    expect(
      (await get("/billing/summary?month=2025-02")).body.billedAmount,
    ).toBe(0);
  });
  it("distinguishes cash receipt month from billing month and includes only valid payments", async () => {
    const id = await charge();
    await post(
      "/billing/payments",
      payment(id, 300, { paidAt: "2025-03-01T00:00:00+05:00" }),
    );
    const p = (
      await post(
        "/billing/payments",
        payment(id, 200, { paidAt: "2025-02-28T23:59:59+05:00" }),
      )
    ).body.payment;
    expect((await get("/billing/summary?month=2025-02")).body).toMatchObject({
      billedAmount: 1000,
      receivedAmount: 200,
      outstandingAmount: 500,
      paymentCount: 1,
    });
    expect((await get("/billing/summary?month=2025-03")).body).toMatchObject({
      billedAmount: 0,
      receivedAmount: 300,
      outstandingAmount: 0,
      paymentCount: 1,
    });
    expect((await get("/billing/payments?month=2025-03")).body.total).toBe(1);
    await post(`/billing/payments/${p.id}/reverse`, {
      reason: "Xato tolov",
      confirmed: true,
    });
    expect((await get("/billing/summary?month=2025-02")).body).toMatchObject({
      receivedAmount: 0,
      outstandingAmount: 700,
      paymentCount: 0,
    });
    expect((await get("/dashboard")).body.financial.month).toBe(
      currentBillingMonth(),
    );
    expect((await get("/dashboard", teacher)).body.financial).toBeUndefined();
    expect((await get("/dashboard", platform)).body.financial).toBeUndefined();
    expect(
      (
        await get(
          `/billing/charges?search=Sinov%20Oquvchi&groupId=${groupId}&status=partial`,
        )
      ).body.total,
    ).toBe(1);
    expect(
      (await get("/billing/charges?pageSize=1&page=2")).body.charges,
    ).toHaveLength(0);
  });
});

describe("6.6.1 automatic tuition and financial safety", () => {
  async function prepareNovember() {
    await Schedule.deleteMany({});
    await Group.updateOne({ _id: groupId }, { monthlyFee: 300000 });
    await Membership.deleteMany({});
    await Membership.create({
      tenantId: tenant,
      groupId,
      studentId,
      enrolledAt: "2026-11-16T09:00:00+05:00",
    });
    await Schedule.create(
      [1, 3, 5].map((dayOfWeek) => ({
        tenantId: tenant,
        groupId,
        teacherId: new mongoose.Types.ObjectId(),
        classroomId: new mongoose.Types.ObjectId(),
        dayOfWeek,
        startTime: "10:00",
        endTime: "11:00",
      })),
    );
  }
  it("serializes manual and scheduled generation, keeps discount separate, and preserves paid snapshots on schedule changes", async () => {
    await prepareNovember();
    const actor = (await User.findOne({
      tenantId: tenant,
      role: "business_owner",
    }))!;
    const { generateTuitionMonth } = await import("../src/tuition-service.js");
    const results = await Promise.all([
      generate("2026-11"),
      generateTuitionMonth(tenant, actor._id, "2026-11", "scheduled"),
    ]);
    expect((results[0] as { status: number }).status).toBe(200);
    expect(await Charge.countDocuments()).toBe(1);
    let c = (await Charge.findOne())!;
    expect(c.toObject()).toMatchObject({
      originalAmount: 300000,
      prorationAmount: 138462,
      discountAmount: 0,
      finalAmount: 161538,
      calculation: {
        monthlyFee: 300000,
        totalLessons: 13,
        eligibleLessons: 7,
        calculatedAmount: 161538,
        policyVersion: "lesson-tashkent-v1",
      },
    });
    const snapshot = c.toObject().calculation;
    expect(
      (
        await patch(`/billing/charges/${c.id}`, {
          originalAmount: 300000,
          discountAmount: 10000,
          reason: "Qo‘lda chegirma",
        })
      ).status,
    ).toBe(200);
    c = (await Charge.findById(c._id))!;
    expect(c.finalAmount).toBe(151538);
    expect(
      (await post("/billing/payments", payment(c.id, 151538))).status,
    ).toBe(201);
    const before = (await Charge.findById(c._id))!.toObject();
    await Schedule.updateMany({}, { startTime: "15:00", status: "inactive" });
    await Group.updateOne({ _id: groupId }, { monthlyFee: 900000 });
    expect((await generate("2026-11")).body.created).toBe(0);
    expect((await Charge.findById(c._id))!.toObject()).toEqual(before);
    expect((await Charge.findById(c._id))!.toObject().calculation).toEqual(
      snapshot,
    );
    expect(
      (
        await patch(`/billing/charges/${c.id}`, {
          originalAmount: 300000,
          discountAmount: 10001,
          reason: "Kamaytirish",
        })
      ).status,
    ).toBe(409);
    // Nested document changes and query-level replacement cannot rewrite the quote.
    const immutable = (await Charge.findById(c._id))!;
    immutable.calculation!.eligibleLessons = 999;
    await expect(immutable.save()).rejects.toThrow(
      "Billing calculation cannot change",
    );
    await expect(
      Charge.updateOne(
        { _id: c._id },
        { $set: { "calculation.eligibleLessons": 999 } },
      ),
    ).rejects.toThrow("Billing calculation cannot change");
    expect((await Charge.findById(c._id))!.calculation!.eligibleLessons).toBe(
      7,
    );
  });
  it("creates the first charge atomically on enrollment and checks preview changes, RBAC and tenant isolation", async () => {
    await Membership.deleteMany({});
    const previewPath = `/groups/${groupId}/billing-preview?studentId=${studentId}`;
    expect((await get(previewPath, teacher)).status).toBe(403);
    expect((await get(previewPath, other)).status).toBe(404);
    const preview = await get(previewPath);
    expect(preview.status).toBe(200);
    expect(preview.body.calculation.policyVersion).toBe("lesson-tashkent-v1");
    await Group.updateOne({ _id: groupId }, { monthlyFee: 2000 });
    const stale = await post(`/groups/${groupId}/members`, {
      studentId,
      billingPreviewKey: preview.body.previewKey,
    });
    expect(stale.status).toBe(409);
    expect(await Membership.countDocuments()).toBe(0);
    expect(await Charge.countDocuments()).toBe(0);
    const fresh = await get(previewPath);
    expect(
      (
        await post(`/groups/${groupId}/members`, {
          studentId,
          billingPreviewKey: fresh.body.previewKey,
        })
      ).status,
    ).toBe(201);
    expect(await Charge.countDocuments()).toBe(1);
    expect((await Charge.findOne())!.generationSource).toBe("enrollment");
    expect((await generate(currentBillingMonth())).body.created).toBe(0);
    await post(`/groups/${groupId}/members/${studentId}/remove`, {});
    expect(
      (await post(`/groups/${groupId}/members`, { studentId })).status,
    ).toBe(201);
    expect(await Charge.countDocuments()).toBe(1);
  });
  it("does not rewrite legacy charges or approved payroll and calculates percentages from prorated net amounts", async () => {
    await prepareNovember();
    await generate("2026-11");
    const c = (await Charge.findOne())!;
    const { SalaryRule, Payroll } = await import("../src/payroll-models.js");
    const { calculatePayroll } = await import("../src/payroll-calculation.js");
    const g = (await Group.findById(groupId))!;
    const actor = (await User.findOne({
      tenantId: tenant,
      role: "business_owner",
    }))!;
    await SalaryRule.create({
      tenantId: tenant,
      teacherId: g.teacherId,
      salaryType: "billed",
      percentage: 40,
      effectiveFrom: "2026-01-01",
      createdBy: actor._id,
    });
    expect(
      (
        await post(
          "/billing/payments",
          payment(c.id, 100000, { paidAt: "2026-11-01T10:00:00+05:00" }),
        )
      ).status,
    ).toBe(201);
    await SalaryRule.updateMany(
      { tenantId: tenant },
      { salaryType: "collected" },
    );
    const collected = await mongoose.connection.transaction((tx) =>
      calculatePayroll(tenant, String(g.teacherId), "2026-11", tx),
    );
    expect(collected.grossSalary).toBe(40000);
    expect(collected.lines[0]!.basisAmount).toBe(100000);
    await SalaryRule.updateMany({ tenantId: tenant }, { salaryType: "billed" });
    const basis = await mongoose.connection.transaction((tx) =>
      calculatePayroll(tenant, String(g.teacherId), "2026-11", tx),
    );
    expect(basis.grossSalary).toBe(64615);
    expect(basis.lines[0]!.basisAmount).toBe(161538);
    const approved = await Payroll.create({
      tenantId: tenant,
      teacherId: g.teacherId,
      payrollMonth: "2026-11",
      status: "approved",
      calculationBasis: basis,
      grossSalary: basis.grossSalary,
      finalSalary: basis.grossSalary,
      calculatedAt: new Date(),
      createdBy: actor._id,
      approvedBy: actor._id,
      approvedAt: new Date(),
    });
    const before = approved.toObject();
    await Schedule.updateMany({}, { status: "inactive" });
    await generate("2026-11");
    expect((await Payroll.findById(approved._id))!.toObject()).toEqual(before);
    // A pre-feature record has no calculation: generation must leave it untouched.
    await Charge.deleteOne({ _id: c._id });
    const legacy = await Charge.create({
      tenantId: tenant,
      studentId,
      groupId,
      billingMonth: "2026-11",
      generatedBy: actor._id,
      originalAmount: 300000,
      finalAmount: 300000,
      paidAmount: 300000,
      dueDate: new Date("2026-11-10"),
    });
    const old = legacy.toObject();
    await generate("2026-11");
    expect((await Charge.findById(legacy._id))!.toObject()).toEqual(old);
    await SalaryRule.deleteMany({ tenantId: tenant });
    await Payroll.deleteMany({ tenantId: tenant });
  });
  it("keeps configured policies on unrelated group edits and honors opt-out", async () => {
    expect(
      (
        await patch(`/groups/${groupId}`, {
          billingPolicy: "full_month",
          billingDueDay: 25,
        })
      ).status,
    ).toBe(200);
    expect(
      (await patch(`/groups/${groupId}`, { description: "Siyosat saqlanadi" }))
        .status,
    ).toBe(200);
    const g = (await Group.findById(groupId))!;
    expect(g.billingPolicy).toBe("full_month");
    expect(g.billingDueDay).toBe(25);
    await Membership.deleteMany({});
    const preview = await get(
      `/groups/${groupId}/billing-preview?studentId=${studentId}`,
    );
    expect(preview.body.calculation).toMatchObject({
      policy: "full_month",
      calculatedAmount: 1000,
    });
  });
  it("authenticates the scheduler separately and retries idempotently without caller-selected months/tenants", async () => {
    const secret = randomBytes(48).toString("base64url");
    const scheduledApp = createApp({
      ...config,
      BILLING_SCHEDULER_ENABLED: true, BILLING_SCHEDULER_SECRET: secret,
    });
    const path = "/api/internal/billing/run";
    expect((await request(app).post(path).send({})).status).toBe(503);
    expect(
      (await request(scheduledApp).post(path).set("Cookie", owner).send({}))
        .status,
    ).toBe(401);
    expect(
      (
        await request(scheduledApp)
          .post(path)
          .set("Authorization", "Bearer wrong")
          .send({})
      ).status,
    ).toBe(401);
    expect(
      (
        await request(scheduledApp)
          .post(path)
          .set("Authorization", `Bearer ${secret}`)
          .send({ month: "2020-01", tenantId: tenant })
      ).status,
    ).toBe(400);
    const first = await request(scheduledApp)
      .post(path)
      .set("Authorization", `Bearer ${secret}`)
      .send({});
    expect(first.status).toBe(200);
    expect(first.body.created).toBe(1);
    const again = await request(scheduledApp)
      .post(path)
      .set("Authorization", `Bearer ${secret}`)
      .send({});
    expect(again.status).toBe(200);
    expect(again.body.created).toBe(0);
  });
});


describe("Phase B monthly preview, audit and recovery", () => {
  const now = new Date("2026-11-01T00:00:00+05:00");
  async function secondMember() {
    const u = (await User.findOne({ tenantId: tenant, role: "business_owner" }))!;
    const student = await Student.create({ tenantId: tenant, createdBy: u._id,
      firstName: "Synthetic", lastName: "Second", enrollmentDate: "2025-01-01" });
    await Membership.create({ tenantId: tenant, studentId: student._id, groupId, enrolledAt: "2025-01-01" });
    return u;
  }
  it("previews the exact monthly amount without touching charges, locks or audit, even with scheduler disabled", async () => {
    const before = (await Tenant.findById(tenant))!.toObject();
    const preview = await post("/billing/charges/preview", { month: "2026-11" }, admin);
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ month: "2026-11", dryRun: true, created: 0, wouldCreate: 1, skipped: 0, amount: 1000 });
    expect(await Charge.countDocuments()).toBe(0);
    expect(await TuitionRun.countDocuments()).toBe(0);
    expect((await Tenant.findById(tenant))!.toObject()).toEqual(before);
    const batch = await runTuitionBatch(undefined, now, true);
    expect(batch).toMatchObject({ dryRun: true, created: 0, wouldCreate: 1 });
    expect(await TuitionRun.countDocuments()).toBe(0);
    expect((await Tenant.findById(tenant))!.toObject()).toEqual(before);
    expect((await generate("2026-11")).body).toMatchObject({ created: 1, amount: preview.body.amount });
    expect((await post("/billing/charges/preview", { month: "2026-11" })).body).toMatchObject({ wouldCreate: 0, skipped: 1, amount: 0 });
  });
  it("enforces preview and history RBAC, rejects tenant injection, and separates tenant history", async () => {
    await runTuitionBatch(undefined, now);
    for (const cookie of [teacher, platform]) {
      expect((await get("/billing/automation", cookie)).status).toBe(403);
      expect((await post("/billing/charges/preview", { month: "2026-11" }, cookie)).status).toBe(403);
    }
    expect((await post("/billing/charges/preview", { month: "2026-11", tenantId: otherTenant })).status).toBe(400);
    expect((await get(`/billing/automation?tenantId=${otherTenant}`)).status).toBe(400);
    const a = await get("/billing/automation?month=2026-11", admin);
    const b = await get("/billing/automation?month=2026-11", other);
    expect(a.body).toMatchObject({ schedulerEnabled: false, total: 1 });
    expect(a.body.runs[0]).toMatchObject({ status: "completed", created: 1, amount: 1000, errorCode: null });
    expect(b.body.runs[0]).toMatchObject({ status: "completed", created: 0, amount: 0 });
    expect(a.body.runs[0].id).not.toBe(b.body.runs[0].id);
    expect(a.body.runs[0].tenantId).toBeUndefined();
    expect((await get("/billing/automation?month=2026-12")).body.total).toBe(0);
    expect((await get("/billing/automation?page=2")).body.runs).toEqual([]);
    expect((await get("/billing/automation?page=0")).status).toBe(400);
  });
  it("keeps secret-only deployments disabled, permits authenticated dry-run and preserves manual fallback", async () => {
    const secret = randomBytes(48).toString("base64url");
    const disabled = createApp({ ...config, BILLING_SCHEDULER_SECRET: secret });
    const trigger = (body: object, token = secret) => request(disabled).post("/api/internal/billing/run")
      .set("Authorization", `Bearer ${token}`).send(body);
    expect((await trigger({})).status).toBe(503);
    expect((await trigger({ dryRun: true }, "wrong")).status).toBe(401);
    expect((await trigger({ dryRun: true, month: "2020-01" })).status).toBe(400);
    expect((await trigger({ dryRun: "true" })).status).toBe(400);
    expect((await trigger({ dryRun: true })).body).toMatchObject({ created: 0, wouldCreate: 1, dryRun: true });
    expect(await TuitionRun.countDocuments()).toBe(0);
    expect(await Charge.countDocuments()).toBe(0);
    expect((await generate()).status).toBe(200);
  });
  it("rolls back a mid-tenant failure, persists only a safe error code, then retries without duplicates", async () => {
    await secondMember();
    const original = Charge.create.bind(Charge);
    let inserts = 0;
    const spy = vi.spyOn(Charge, "create").mockImplementation((async (...args: unknown[]) => {
      if (++inserts === 2) throw new Error("synthetic-sensitive-URI-and-secret");
      return (original as (...args: unknown[]) => Promise<unknown>)(...args);
    }) as typeof Charge.create);
    try { await expect(runTuitionBatch(undefined, now)).rejects.toThrow("synthetic-sensitive"); }
    finally { spy.mockRestore(); }
    expect(inserts).toBe(2);
    expect(await Charge.countDocuments({ tenantId: tenant })).toBe(0);
    const failed = await TuitionRun.findOne({ tenantId: tenant });
    expect(failed!.toObject()).toMatchObject({ status: "failed", created: 0, skipped: 0, amount: 0, errorCode: "BILLING_RUN_FAILED" });
    expect(JSON.stringify(failed)).not.toContain("synthetic-sensitive");
    expect((await runTuitionBatch(undefined, now)).created).toBe(2);
    expect((await runTuitionBatch(undefined, now)).created).toBe(0);
    expect(await Charge.countDocuments()).toBe(2);
    expect(await TuitionRun.countDocuments({ tenantId: tenant, status: "completed" })).toBe(2);
  });
  it("retries a transient transaction with fresh counters and a single atomic completion", async () => {
    await secondMember();
    const original = Charge.create.bind(Charge);
    let inserts = 0;
    const spy = vi.spyOn(Charge, "create").mockImplementation((async (...args: unknown[]) => {
      if (++inserts === 2) {
        const error = new mongoose.mongo.MongoServerError({ message: "synthetic conflict", code: 112 });
        error.addErrorLabel("TransientTransactionError");
        throw error;
      }
      return (original as (...args: unknown[]) => Promise<unknown>)(...args);
    }) as typeof Charge.create);
    try { expect((await runTuitionBatch(undefined, now)).created).toBe(2); }
    finally { spy.mockRestore(); }
    expect(inserts).toBe(4);
    expect(await Charge.countDocuments()).toBe(2);
    expect((await TuitionRun.findOne({ tenantId: tenant }))!.toObject()).toMatchObject({ status: "completed", created: 2, skipped: 0, amount: 2000 });
  });
  it("rolls back charges if recording completion fails and manual billing remains independent of audit", async () => {
    const spy = vi.spyOn(TuitionRun, "updateOne").mockImplementationOnce(() => { throw new Error("synthetic audit failure"); });
    try { await expect(runTuitionBatch(undefined, now)).rejects.toThrow("synthetic audit failure"); }
    finally { spy.mockRestore(); }
    expect(await Charge.countDocuments()).toBe(0);
    expect((await TuitionRun.findOne({ tenantId: tenant }))!.status).toBe("failed");
    const unavailable = vi.spyOn(TuitionRun, "create").mockRejectedValue(new Error("synthetic audit unavailable"));
    try { expect((await generate("2026-11")).body.created).toBe(1); }
    finally { unavailable.mockRestore(); }
  });
  it("serializes concurrent scheduler attempts and manual generation; cancelled charges remain final", async () => {
    const actor = await secondMember();
    const results = await Promise.all([
      runTuitionBatch(undefined, now), runTuitionBatch(undefined, now),
      generateTuitionMonth(tenant, actor._id, "2026-11", "manual"),
    ]);
    expect(results.reduce((sum, r) => sum + r.created, 0)).toBe(2);
    expect(await Charge.countDocuments()).toBe(2);
    expect(await TuitionRun.countDocuments({ status: "failed" })).toBe(0);
    await Charge.updateMany({ tenantId: tenant }, { cancelled: true });
    const before = await Charge.find().lean();
    expect((await runTuitionBatch(undefined, now)).created).toBe(0);
    expect(await Charge.find().lean()).toEqual(before);
  });
  it("excludes inactive students, paused groups, removed memberships and cross-tenant references", async () => {
    await Student.updateOne({ _id: studentId }, { status: "archived" });
    expect((await runTuitionBatch(undefined, now, true)).wouldCreate).toBe(0);
    await Student.updateOne({ _id: studentId }, { status: "active" });
    await Group.updateOne({ _id: groupId }, { status: "paused" });
    expect((await runTuitionBatch(undefined, now, true)).wouldCreate).toBe(0);
    await Group.updateOne({ _id: groupId }, { status: "active" });
    await Membership.updateMany({ tenantId: tenant }, { status: "removed" });
    expect((await runTuitionBatch(undefined, now, true)).wouldCreate).toBe(0);
    await Membership.create({ tenantId: otherTenant, studentId, groupId, enrolledAt: "2025-01-01" });
    expect((await runTuitionBatch(undefined, now)).created).toBe(0);
    expect(await Charge.countDocuments()).toBe(0);
  });
});
