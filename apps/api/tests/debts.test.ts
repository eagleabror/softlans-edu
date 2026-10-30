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
import {
  debtSummary,
  daysOverdue,
  agingBucket,
  csvCell,
} from "../src/debts.js";
import { debtInput } from "../src/debt-validation.js";
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

describe("ledger-derived tenant debts", () => {
  it("includes unpaid and partial, excludes full/cancelled, restores reversed amounts without mutating history", async () => {
    const id = await charge();
    const original = (await Charge.findById(id))!.toObject();
    expect((await get("/debts")).body.charges[0]).toMatchObject({
      remainingAmount: 1000,
      paidAmount: 0,
      status: "unpaid",
    });
    const p = (await post("/billing/payments", payment(id, 400))).body.payment;
    expect((await get("/debts")).body.charges[0]).toMatchObject({
      remainingAmount: 600,
      paidAmount: 400,
      status: "partial",
    });
    // Deliberately corrupt the cache: reporting must still use the immutable ledger.
    await Charge.updateOne({ _id: id }, { paidAmount: 999 });
    expect((await get("/debts")).body.charges[0].remainingAmount).toBe(600);
    await post("/billing/payments", payment(id, 600));
    expect((await get("/debts")).body.total).toBe(0);
    const before = (await Payment.findById(p.id))!.toObject();
    await post(`/billing/payments/${p.id}/reverse`, {
      reason: "Sinov qaytarish",
      confirmed: true,
    });
    expect((await get("/debts")).body.charges[0].remainingAmount).toBe(400);
    expect((await Payment.findById(p.id))!.toObject()).toEqual(before);
    await Charge.updateOne({ _id: id }, { cancelled: true });
    expect((await get("/debts")).body.total).toBe(0);
    expect((await get("/debts/summary")).body.outstandingAmount).toBe(0);
    expect(await Charge.countDocuments()).toBe(1);
    expect((await Charge.findById(id))!.originalAmount).toBe(
      original.originalAmount,
    );
  });
  it("clamps overpaid records to zero and counts distinct students across months and duplicate membership history", async () => {
    const id = await charge();
    await generate("2025-03");
    await Membership.updateMany({}, { status: "removed" });
    await Membership.create({
      tenantId: tenant,
      groupId,
      studentId,
      enrolledAt: "2025-01-01",
    });
    const summary = (await get("/debts/summary")).body;
    expect(summary).toMatchObject({
      outstandingAmount: 2000,
      overdueAmount: 2000,
      debtorCount: 1,
      overdueDebtorCount: 1,
      overdueMoreThan30: 2000,
    });
    expect((await get("/debts/groups")).body.groups[0]).toMatchObject({
      groupName: "Sinov",
      outstandingAmount: 2000,
      debtorCount: 1,
    });
    const rowsBefore = await Charge.find({}).lean();
    await get("/debts");
    await get("/debts/summary");
    await get("/debts/export");
    expect(await Charge.find({}).lean()).toEqual(rowsBefore);
    await Charge.updateOne({ _id: id }, { finalAmount: 0 });
    expect((await get("/debts")).body.total).toBe(1);
  });
  it("uses Tashkent calendar days and exact aging boundaries, including year/leap transitions", async () => {
    const id = await charge();
    const now = new Date("2025-03-31T19:00:00Z"); // April 1 in Tashkent
    for (const [date, days, bucket] of [
      ["2025-04-02", 0, "upcoming"],
      ["2025-04-01", 0, "upcoming"],
      ["2025-03-31", 1, "1-7"],
      ["2025-03-25", 7, "1-7"],
      ["2025-03-24", 8, "8-30"],
      ["2025-03-02", 30, "8-30"],
      ["2025-03-01", 31, "31+"],
    ] as const) {
      const due = new Date(`${date}T23:59:59.999+05:00`);
      await Charge.updateOne({ _id: id }, { dueDate: due });
      expect(daysOverdue(due, now)).toBe(days);
      expect(agingBucket(days)).toBe(bucket);
      const stats = await debtSummary(
        { tenantId: tenant },
        debtInput.parse({ status: bucket }),
        now,
      );
      expect(stats.outstandingAmount).toBe(1000);
      expect(stats.overdueAmount).toBe(days ? 1000 : 0);
    }
    const due = new Date("2025-12-31T23:59:59.999+05:00");
    expect(daysOverdue(due, new Date("2025-12-31T18:59:59.999Z"))).toBe(0);
    expect(daysOverdue(due, new Date("2025-12-31T19:00:00Z"))).toBe(1);
    expect(
      daysOverdue(
        new Date("2024-02-28T23:59:59+05:00"),
        new Date("2024-02-29T19:00:00Z"),
      ),
    ).toBe(2);
  });
  it("enforces authentication, RBAC and isolation on every financial read, including exports", async () => {
    await charge();
    const paths = [
      "/debts",
      "/debts/overdue",
      "/debts/summary",
      "/debts/groups",
      "/debts/export",
      `/debts/students/${studentId}`,
    ];
    for (const path of paths) {
      expect((await request(app).get(`/api${path}`)).status).toBe(401);
      for (const cookie of [teacher, platform])
        expect((await get(path, cookie)).status).toBe(403);
      expect((await get(path, admin)).status).toBe(200);
    }
    expect((await get(`/debts/students/${studentId}`, other)).status).toBe(404);
    expect((await get("/debts", other)).body.total).toBe(0);
    expect((await get("/debts/groups", other)).body.groups).toEqual([]);
    expect((await get("/debts/summary", other)).body).toMatchObject({
      debtorCount: 0,
      outstandingAmount: 0,
    });
    expect((await get("/dashboard", teacher)).body.debts).toBeUndefined();
    expect((await get("/dashboard", platform)).body.debts).toBeUndefined();
    expect((await get("/dashboard")).body.debts.debtorCount).toBe(1);
    expect((await get(`/debts?tenantId=${otherTenant}`)).status).toBe(400);
    expect(
      (await get(`/debts?studentId=${new mongoose.Types.ObjectId()}`)).body
        .total,
    ).toBe(0);
  });
  it("ignores foreign ledger references and never returns a negative debt", async () => {
    const id = await charge();
    const p = (await post("/billing/payments", payment(id, 400))).body.payment;
    await PaymentReversal.create({
      tenantId: otherTenant,
      paymentId: p.id,
      recordedBy: new mongoose.Types.ObjectId(),
      reason: "Synthetic foreign reference",
    });
    await Payment.create({
      tenantId: otherTenant,
      studentId,
      chargeId: id,
      recordedBy: new mongoose.Types.ObjectId(),
      amount: 1000,
      method: "cash",
      paidAt: new Date(),
      idempotencyKey: randomUUID(),
      fingerprint: "synthetic",
    });
    expect((await get("/debts")).body.charges[0]).toMatchObject({
      paidAmount: 400,
      remainingAmount: 600,
    });
    await Charge.updateOne({ _id: id }, { finalAmount: 100 });
    expect((await get("/debts")).body.total).toBe(0);
    expect((await get("/debts/summary")).body.outstandingAmount).toBe(0);
  });
  it("validates pagination, escaped name search, month/group/status/amount filters and stable sorting", async () => {
    const id = await charge();
    await generate("2025-03");
    await post("/billing/payments", payment(id, 400));
    expect(
      (await get("/debts?pageSize=1&page=2&sort=remainingAmount&order=desc"))
        .body.charges[0].remainingAmount,
    ).toBe(600);
    expect((await get("/debts?pageSize=1&page=3")).body.charges).toEqual([]);
    expect(
      (
        await get(
          `/debts?search=Sinov%20Oquvchi&groupId=${groupId}&month=2025-02&minAmount=600&maxAmount=600&status=31%2B`,
        )
      ).body.total,
    ).toBe(1);
    expect((await get("/debts?search=.*")).body.total).toBe(0);
    expect((await get("/debts?status=upcoming")).body.total).toBe(0);
    expect((await get("/debts/overdue")).body.total).toBe(2);
    expect(
      (await get(`/debts/students/${studentId}`)).body.summary
        .outstandingAmount,
    ).toBe(1600);
    for (const query of [
      "page=0",
      "pageSize=101",
      "page=10001",
      "minAmount=-1",
      "minAmount=2&maxAmount=1",
      "groupId=bad",
      "sort=tenantId",
      "status=bad",
      "month=2025-13",
      "search[x]=x",
    ])
      expect((await get(`/debts?${query}`)).status).toBe(400);
    expect((await get("/debts/overdue?status=upcoming")).status).toBe(400);
  });
  it("quotes CSV cells and neutralizes formula injection, with safe fixed headers", async () => {
    await charge();
    await Group.updateOne({ _id: groupId }, { name: '=HYPERLINK("evil")' });
    const result = await get("/debts/export");
    expect(result.status).toBe(200);
    expect(result.headers["content-type"]).toContain("text/csv");
    expect(result.headers["content-disposition"]).toBe(
      'attachment; filename="qarzdorlar.csv"',
    );
    expect(result.text).toContain(`"'=HYPERLINK(""evil"")"`);
    for (const value of [
      "=1+1",
      "+cmd",
      "-1",
      "@SUM(A1)",
      "  =1",
      "\tformula",
      "\r=1",
    ])
      expect(csvCell(value).startsWith(`"'`)).toBe(true);
    expect(csvCell('a,b"c')).toBe('"a,b""c"');
    expect((await get("/debts/export", other)).text).not.toContain("HYPERLINK");
  });
});
