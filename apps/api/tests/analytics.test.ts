import { beforeAll, afterAll, beforeEach, it, expect } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import request from "supertest";
import { randomBytes, randomUUID } from "node:crypto";
import {
  analyticsInput,
  financialReport,
  period,
  collectionRate,
} from "../src/analytics.js";
import { Charge, Payment, PaymentReversal } from "../src/billing-models.js";
import { Tenant, User } from "../src/models.js";
import { Group, Membership } from "../src/group-models.js";
import { createApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import { issueToken } from "../src/security.js";
const config = parseConfig({
  NODE_ENV: "test",
  APP_ORIGIN: "http://localhost:5173",
  JWT_SECRET: randomBytes(48).toString("hex"),
  MONGODB_URI: "mongodb://localhost/test",
});
const app = createApp(config),
  oid = () => new mongoose.Types.ObjectId();
let repl: MongoMemoryReplSet,
  tenant: mongoose.Types.ObjectId,
  groupId: mongoose.Types.ObjectId,
  studentId: mongoose.Types.ObjectId;
const q = () =>
  analyticsInput.parse({ start: "2025-02-01", end: "2025-02-28" });
const report = () => financialReport({ tenantId: tenant }, q());
async function charge(extra = {}) {
  return Charge.create({
    tenantId: tenant,
    generatedBy: oid(),
    studentId,
    groupId,
    billingMonth: "2025-02",
    originalAmount: 1000,
    discountAmount: 0,
    finalAmount: 1000,
    paidAmount: 999,
    dueDate: "2025-02-21T23:59:59+05:00",
    ...extra,
  });
}
async function pay(
  chargeId: mongoose.Types.ObjectId,
  amount: number,
  extra = {},
) {
  return Payment.create({
    tenantId: tenant,
    studentId,
    chargeId,
    amount,
    method: "cash",
    paidAt: "2025-02-10T12:00:00+05:00",
    recordedBy: oid(),
    idempotencyKey: randomUUID(),
    fingerprint: "test",
    ...extra,
  });
}
beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: "7.0.24" },
  });
  await mongoose.connect(repl.getUri());
});
afterAll(async () => {
  await mongoose.disconnect();
  await repl?.stop();
});
beforeEach(async () => {
  for (const model of [
    Charge,
    Payment,
    PaymentReversal,
    Group,
    Membership,
    User,
    Tenant,
  ])
    await model.deleteMany({});
  tenant = (await Tenant.create({ name: "A" }))._id;
  studentId = oid();
  groupId = (
    await Group.create({
      tenantId: tenant,
      name: "=SUM(1)",
      teacherId: oid(),
      courseName: "Fan",
      capacity: 20,
      monthlyFee: 1000,
      startDate: "2025-01-01",
    })
  )._id;
});
it("reconciles partial/full/cancelled/reversed payments and caps each charge without trusting cache", async () => {
  const a = await charge(),
    b = await charge({ studentId: oid() }),
    c = await charge({ studentId: oid(), cancelled: true });
  await pay(a._id, 400);
  await pay(b._id, 1000, { studentId: b.studentId });
  await pay(c._id, 200, { studentId: c.studentId });
  const reversed = await pay(a._id, 100);
  await PaymentReversal.create({
    tenantId: tenant,
    paymentId: reversed._id,
    reason: "test",
    recordedBy: oid(),
  });
  let d = await report();
  expect(d.summary).toMatchObject({
    payments: 1400,
    paymentCount: 2,
    billed: 2000,
    collected: 1400,
    outstanding: 600,
    overdue: 600,
    debtors: 1,
    rate: 70,
  });
  expect(d.monthly[0]).toMatchObject({
    payments: 1400,
    collected: 1400,
    billed: 2000,
    count: 2,
  });
  expect(d.methods[0]?.amount).toBe(1400);
  expect(d.aging.find((r) => r.bucket === "1-7")?.amount).toBe(600);
  await Charge.updateOne({ _id: a._id }, { finalAmount: 100 });
  d = await report();
  expect(d.summary).toMatchObject({
    billed: 1100,
    collected: 1100,
    outstanding: 0,
    rate: 100,
  });
});
it("uses payment instants with Tashkent inclusive days and distinct billing cohorts", async () => {
  const old = await charge({ billingMonth: "2025-01" }),
    current = await charge();
  await pay(old._id, 300);
  await pay(current._id, 100, { paidAt: "2025-01-31T18:59:59.999Z" });
  await pay(current._id, 200, { paidAt: "2025-01-31T19:00:00Z" });
  await pay(current._id, 100, { paidAt: "2025-02-28T18:59:59.999Z" });
  await pay(current._id, 100, { paidAt: "2025-02-28T19:00:00Z" });
  const d = await report();
  expect(d.summary).toMatchObject({
    payments: 600,
    paymentCount: 3,
    billed: 1000,
    collected: 400,
    outstanding: 600,
    overdue: 1300,
    debtors: 1,
    rate: 40,
  });
  expect(d.monthly[0]?.payments).toBe(600);
  expect(period(q()).start.toISOString()).toBe("2025-01-31T19:00:00.000Z");
  expect(period(q()).end.toISOString()).toBe("2025-02-28T19:00:00.000Z");
});
it("counts memberships distinctly, supports zero-charge groups, and prevents multi-group multiplication", async () => {
  const second = await Group.create({
    tenantId: tenant,
    name: "B",
    teacherId: oid(),
    courseName: "Fan",
    capacity: 20,
    monthlyFee: 1000,
    startDate: "2025-01-01",
  });
  await Membership.create([
    { tenantId: tenant, groupId, studentId, status: "removed" },
    { tenantId: tenant, groupId, studentId },
    { tenantId: tenant, groupId: second._id, studentId },
  ]);
  const a = await charge(),
    b = await charge({ groupId: second._id });
  await pay(a._id, 300);
  await pay(b._id, 1000);
  let d = await report();
  expect(d.summary).toMatchObject({
    billed: 2000,
    collected: 1300,
    debtors: 1,
    rate: 65,
  });
  expect(d.groups.find((g) => g.id === String(groupId))).toMatchObject({
    students: 1,
    billed: 1000,
    collected: 300,
    outstanding: 700,
    rate: 30,
  });
  d = await financialReport(
    { tenantId: tenant },
    analyticsInput.parse({ ...q(), groupId: String(second._id) }),
  );
  expect(d.summary.billed).toBe(1000);
  expect(d.groups).toHaveLength(1);
  await Charge.deleteMany({ groupId: second._id });
  d = await report();
  expect(d.groups.find((g) => g.id === String(second._id))?.billed).toBe(0);
});
it("ages debt on local calendar day boundaries, including future due dates", async () => {
  for (const [due, bucket] of [
    ["2025-03-01", "upcoming"],
    ["2025-02-28", "upcoming"],
    ["2025-02-27", "1-7"],
    ["2025-02-21", "1-7"],
    ["2025-02-20", "8-30"],
    ["2025-01-29", "8-30"],
    ["2025-01-28", "31+"],
  ])
    await charge({ studentId: oid(), dueDate: `${due}T23:59:59+05:00` });
  const d = await report();
  expect(d.aging.map((r) => r.amount)).toEqual([2000, 2000, 2000, 1000]);
  expect(d.summary.overdue).toBe(5000);
});
it("returns zeros, validates ranges/leap days/query fields and rounds deterministically", async () => {
  const d = await report();
  expect(d.summary).toMatchObject({
    payments: 0,
    billed: 0,
    collected: 0,
    rate: 0,
    debtors: 0,
  });
  expect(d.monthly).toHaveLength(1);
  for (const extra of [
    { start: "2025-02-30" },
    { start: "2024-01-01" },
    { end: "2025-01-01" },
    { tenantId: String(oid()) },
    { groupId: "bad" },
    { pageSize: 101 },
    { sort: "tenantId" },
    { end: "2099-01-01" },
  ])
    expect(analyticsInput.safeParse({ ...q(), ...extra }).success).toBe(false);
  expect(collectionRate(1, 3)).toBe(33.33);
  expect(collectionRate(2, 3)).toBe(66.67);
  expect(collectionRate(4, 3)).toBe(100);
});
it("enforces RBAC and tenant isolation on every endpoint, exports safe CSV without student PII", async () => {
  const a = await charge();
  await pay(a._id, 400);
  const cookie = async (
    role: string,
    tenantId: mongoose.Types.ObjectId | null,
  ) => {
    const u = await User.create({
      role,
      tenantId,
      name: "Actor",
      email: `${oid()}@test.uz`,
      passwordHash: "unused",
    });
    return `softlans_session=${issueToken(u, config)}`;
  };
  const owner = await cookie("business_owner", tenant),
    admin = await cookie("admin", tenant),
    teacher = await cookie("teacher", tenant),
    platform = await cookie("super_admin", null),
    other = await cookie(
      "business_owner",
      (await Tenant.create({ name: "Other" }))._id,
    );
  for (const endpoint of [
    "dashboard",
    "summary",
    "monthly-payments",
    "billing-collection",
    "debt-aging",
    "payment-methods",
    "groups",
    "export",
  ]) {
    const path = `/api/analytics/${endpoint}?start=2025-02-01&end=2025-02-28`;
    expect((await request(app).get(path)).status).toBe(401);
    for (const c of [teacher, platform])
      expect((await request(app).get(path).set("Cookie", c)).status).toBe(403);
    expect((await request(app).get(path).set("Cookie", admin)).status).toBe(
      200,
    );
  }
  const path = "/api/analytics/dashboard?start=2025-02-01&end=2025-02-28";
  const isolated = await request(app)
    .get(path + `&groupId=${groupId}`)
    .set("Cookie", other);
  expect(isolated.body.summary.payments).toBe(0);
  expect(isolated.body.groups).toEqual([]);
  // A foreign reversal cannot hide a payment.
  await PaymentReversal.create({
    tenantId: oid(),
    paymentId: (await Payment.findOne())!._id,
    reason: "test",
    recordedBy: oid(),
  });
  expect((await report()).summary.payments).toBe(400);
  for (const kind of ["monthly", "groups", "methods", "aging"]) {
    const r = await request(app)
      .get(
        `/api/analytics/export?start=2025-02-01&end=2025-02-28&report=${kind}`,
      )
      .set("Cookie", owner);
    expect(r.status).toBe(200);
    expect(r.text).not.toContain(String(studentId));
    if (kind === "groups") expect(r.text).toContain('"\'=SUM(1)"');
  }
});
