import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
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
import { issueToken } from "../src/security.js";
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
  return `softlans_session=${issueToken(u, config)}`;
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
