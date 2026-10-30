import { beforeAll, afterAll, beforeEach, it, expect } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { createApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import { connectDatabase } from "../src/db.js";
import { ensureIndexes, Tenant, User } from "../src/models.js";
import { Group } from "../src/group-models.js";
import { Charge, Payment, PaymentReversal } from "../src/billing-models.js";
import {
  SalaryRule,
  Payroll,
  SalaryPayout,
  SalaryPayoutReversal,
  PayrollAudit,
} from "../src/payroll-models.js";
import { issueToken } from "../src/security.js";
import { percentageSalary } from "../src/payroll-calculation.js";
import { monthBounds } from "../src/billing-validation.js";
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
  teacherId: string,
  groupId: string;
let owner: string,
  admin: string,
  self: string,
  other: string,
  otherTeacher: string,
  platform: string;
async function actor(
  role: "business_owner" | "admin" | "teacher" | "super_admin",
  tenantId: mongoose.Types.ObjectId | null,
) {
  const user = await User.create({
    role,
    tenantId,
    name: "Sinov",
    email: randomUUID() + "@example.test",
    passwordHash: "unused",
  });
  return {
    id: user.id as string,
    cookie: "softlans_session=" + issueToken(user, config),
  };
}
const get = (path: string, cookie = owner) =>
  request(app)
    .get("/api/payroll" + path)
    .set("Cookie", cookie);
const post = (path: string, body: object, cookie = owner) =>
  request(app)
    .post("/api/payroll" + path)
    .set("Cookie", cookie)
    .set("Origin", origin)
    .send(body);
const rule = (extra = {}) =>
  post("/rules", {
    teacherId,
    salaryType: "collected",
    percentage: 33.33,
    effectiveFrom: "2025-01-01",
    reason: "Kelishilgan maosh",
    ...extra,
  });
const preview = (month = "2025-02", id = teacherId) =>
  post("/preview", { teacherId: id, month });
async function charge(extra = {}) {
  return Charge.create({
    tenantId: tenant,
    generatedBy: teacherId,
    studentId: new mongoose.Types.ObjectId(),
    groupId,
    payrollTeacherId: teacherId,
    billingMonth: "2025-02",
    originalAmount: 1001,
    discountAmount: 0,
    finalAmount: 1001,
    paidAmount: 0,
    dueDate: new Date("2025-02-10"),
    ...extra,
  });
}
async function pay(
  chargeId: mongoose.Types.ObjectId,
  amount = 1001,
  paidAt = "2025-02-10T10:00:00+05:00",
) {
  return Payment.create({
    tenantId: tenant,
    studentId: new mongoose.Types.ObjectId(),
    chargeId,
    amount,
    paidAt,
    method: "cash",
    recordedBy: teacherId,
    idempotencyKey: randomUUID(),
    fingerprint: "test",
  });
}
async function draft() {
  return (
    await post("/drafts", { teacherId, month: "2025-02", confirmed: true })
  ).body.payroll;
}
async function approved() {
  await rule({ salaryType: "fixed", fixedAmount: 1000, percentage: null });
  const d = await draft();
  return (
    await post("/" + d.id + "/approve", {
      revision: d.revision,
      confirmed: true,
    })
  ).body.payroll;
}
const payout = (amount = 400, extra = {}) => ({
  amount,
  paidAt: "2025-02-10T10:00:00+05:00",
  method: "cash",
  idempotencyKey: randomUUID(),
  confirmed: true,
  ...extra,
});
beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: "7.0.24" },
  });
  await connectDatabase(repl.getUri("payroll"));
  await ensureIndexes();
}, 120000);
afterAll(async () => {
  await mongoose.disconnect();
  await repl?.stop();
});
beforeEach(async () => {
  for (const m of [
    SalaryRule,
    Payroll,
    SalaryPayout,
    SalaryPayoutReversal,
    PayrollAudit,
    PaymentReversal,
    Payment,
    Charge,
    Group,
    User,
    Tenant,
  ])
    await m.deleteMany({});
  tenant = (await Tenant.create({ name: "Tenant" }))._id;
  const t = await actor("teacher", tenant);
  teacherId = t.id;
  self = t.cookie;
  owner = (await actor("business_owner", tenant)).cookie;
  admin = (await actor("admin", tenant)).cookie;
  const ot = await actor("teacher", tenant);
  otherTeacher = ot.cookie;
  const otherTenant = await Tenant.create({ name: "Other" });
  other = (await actor("business_owner", otherTenant._id)).cookie;
  platform = (await actor("super_admin", null)).cookie;
  groupId = (
    await Group.create({
      tenantId: tenant,
      teacherId,
      name: "Guruh",
      courseName: "Kurs",
      capacity: 10,
      monthlyFee: 1001,
      startDate: new Date("2025-01-01"),
    })
  ).id;
});
it("rounds integer UZS half up using exact arithmetic and Tashkent boundaries", () => {
  expect(percentageSalary(5, 10)).toBe(1);
  expect(percentageSalary(1001, 33.33)).toBe(334);
  expect(percentageSalary(1_000_000_000_000, 99.99)).toBe(999900000000);
  expect(monthBounds("2025-02").start.toISOString()).toBe(
    "2025-01-31T19:00:00.000Z",
  );
  expect(monthBounds("2025-02").end.toISOString()).toBe(
    "2025-02-28T19:00:00.000Z",
  );
});
it("uses collected allocation month, excludes reversals, and respects boundary instants", async () => {
  await rule();
  const c = await charge({ billingMonth: "2025-01" });
  await pay(c._id, 100, "2025-01-31T18:59:59Z");
  await pay(c._id, 101, "2025-01-31T19:00:00Z");
  await pay(c._id, 100, "2025-02-28T19:00:00Z");
  const reversed = await pay(c._id, 500);
  await PaymentReversal.create({
    tenantId: tenant,
    paymentId: reversed._id,
    recordedBy: teacherId,
    reason: "Qaytarilgan",
  });
  const result = await preview();
  expect(result.status).toBe(200);
  expect(result.body.grossSalary).toBe(34);
  expect(result.body.lines[0].sourceIds).toHaveLength(1);
});
it("uses net billed charges once, excludes cancelled charges, and group rules override defaults", async () => {
  await rule({ salaryType: "billed", percentage: 10 });
  await rule({ groupId, salaryType: "billed", percentage: 50 });
  await charge({ discountAmount: 201, finalAmount: 800 });
  await charge({ cancelled: true });
  const second = await Group.create({
    tenantId: tenant,
    teacherId,
    name: "Ikkinchi",
    courseName: "Kurs",
    capacity: 10,
    monthlyFee: 1000,
    startDate: new Date("2025-01-01"),
  });
  await charge({ groupId: second._id, finalAmount: 1000 });
  expect((await preview()).body.grossSalary).toBe(500);
});
it("preserves charge teacher after reassignment, including late collections", async () => {
  await rule();
  const c = await charge({ billingMonth: "2025-01" });
  await pay(c._id);
  const newTeacher = await actor("teacher", tenant);
  await Group.updateOne({ _id: groupId }, { teacherId: newTeacher.id });
  await rule({ teacherId: newTeacher.id });
  expect((await preview()).body.grossSalary).toBe(334);
  expect((await preview("2025-02", newTeacher.id)).body.grossSalary).toBe(0);
});
it("backfills legacy charge attribution before an API teacher reassignment", async () => {
  const c = await charge({ payrollTeacherId: null });
  const nt = await actor("teacher", tenant);
  const response = await request(app)
    .patch("/api/groups/" + groupId + "/teacher")
    .set("Cookie", owner)
    .set("Origin", origin)
    .send({ teacherId: nt.id });
  expect(response.status).toBe(200);
  expect(String((await Charge.findById(c._id))!.payrollTeacherId)).toBe(
    teacherId,
  );
});
it("validates effective dates, percentage fields, overlaps and tenant-owned references", async () => {
  expect((await rule({ effectiveFrom: "2025-01-02" })).status).toBe(400);
  expect((await rule({ percentage: 101 })).status).toBe(400);
  expect((await rule({ effectiveUntil: "2025-01-31" })).status).toBe(201);
  expect((await rule({ effectiveFrom: "2025-01-01" })).status).toBe(409);
  expect(
    (await rule({ effectiveFrom: "2025-02-01", percentage: 20 })).status,
  ).toBe(201);
  expect(
    (await rule({ teacherId: new mongoose.Types.ObjectId().toString() }))
      .status,
  ).toBe(404);
  await charge();
  await pay((await Charge.findOne())!._id);
  expect((await preview()).body.grossSalary).toBe(200);
});
it("pays fixed once without proration, creates drafts idempotently and approves concurrently once", async () => {
  await rule({ salaryType: "fixed", fixedAmount: 1000, percentage: null });
  const [a, b] = await Promise.all([draft(), draft()]);
  expect(a.id).toBe(b.id);
  expect(a.grossSalary).toBe(1000);
  const results = await Promise.all([
    post("/" + a.id + "/approve", { confirmed: true, revision: 0 }),
    post("/" + a.id + "/approve", { confirmed: true, revision: 0 }),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(await Payroll.countDocuments({ status: "approved" })).toBe(1);
  const r = await SalaryRule.findOne();
  await request(app)
    .put("/api/payroll/rules/" + r!.id)
    .set("Cookie", owner)
    .set("Origin", origin)
    .send({
      teacherId,
      salaryType: "fixed",
      fixedAmount: 2000,
      effectiveFrom: "2025-01-01",
      reason: "Yangi kelishuv",
    });
  expect((await get("/" + a.id)).body.payroll.finalSalary).toBe(1000);
});
it("requires adjustment reasons and prevents post-approval mutation", async () => {
  await rule({ salaryType: "fixed", fixedAmount: 1000, percentage: null });
  const d = await draft();
  expect(
    (await post("/" + d.id + "/adjustments", { revision: 0, amount: -100 }))
      .status,
  ).toBe(400);
  const adj = await post("/" + d.id + "/adjustments", {
    revision: 0,
    amount: -100,
    reason: "Tuzatish sababi",
  });
  expect(adj.body.payroll.finalSalary).toBe(900);
  expect(
    (await post("/" + d.id + "/approve", { confirmed: true, revision: 0 }))
      .status,
  ).toBe(409);
  expect(
    (await post("/" + d.id + "/approve", { confirmed: true, revision: 1 }))
      .status,
  ).toBe(200);
  expect(
    (
      await post("/" + d.id + "/recalculate", {
        confirmed: true,
        revision: 2,
        reason: "Qayta hisob",
      })
    ).status,
  ).toBe(409);
});
it("records partial payouts, deduplicates retries, prevents concurrent overpay and audits reversals", async () => {
  const p = await approved(),
    data = payout();
  const [a, b] = await Promise.all([
    post("/" + p.id + "/payouts", data),
    post("/" + p.id + "/payouts", data),
  ]);
  expect([a.status, b.status].sort()).toEqual([200, 201]);
  expect((await get("/" + p.id)).body.payroll.status).toBe("partially_paid");
  expect(
    (await post("/" + p.id + "/payouts", { ...data, amount: 401 })).status,
  ).toBe(409);
  const results = await Promise.all([
    post("/" + p.id + "/payouts", payout(600)),
    post("/" + p.id + "/payouts", payout(600)),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  expect((await get("/" + p.id)).body.payroll.status).toBe("paid");
  expect(
    (
      await post("/" + p.id + "/reverse", {
        confirmed: true,
        reason: "Xato maosh",
      })
    ).status,
  ).toBe(409);
  const history = (await get("/" + p.id + "/payouts")).body.payouts;
  for (const pay of history)
    expect(
      (
        await post("/" + p.id + "/payouts/" + pay.id + "/reverse", {
          confirmed: true,
          reason: "Xato to‘lov",
        })
      ).status,
    ).toBe(204);
  expect(await SalaryPayout.countDocuments()).toBe(2);
  expect((await get("/summary?month=2025-02")).body).toMatchObject({
    approvedSalary: 1000,
    paidSalary: 0,
    outstandingSalary: 1000,
  });
  expect(
    (
      await post("/" + p.id + "/reverse", {
        confirmed: true,
        reason: "Xato maosh",
      })
    ).status,
  ).toBe(204);
  expect((await get("/summary?month=2025-02")).body.approvedSalary).toBe(0);
  expect((await post("/" + p.id + "/payouts", payout())).status).toBe(409);
  expect(
    await PayrollAudit.countDocuments({ action: "payroll_reversed" }),
  ).toBe(1);
});
it("enforces RBAC, teacher own approved access, tenant isolation, strict input and CSRF", async () => {
  for (const cookie of [admin, platform])
    expect((await get("", cookie)).status).toBe(403);
  await rule();
  const d = await draft();
  expect((await get("/" + d.id, self)).status).toBe(404);
  expect(
    (await post("/preview", { teacherId, month: "2025-02" }, self)).status,
  ).toBe(403);
  expect((await get("/" + d.id, other)).status).toBe(404);
  await post("/" + d.id + "/approve", { revision: 0, confirmed: true });
  expect((await get("/" + d.id, self)).status).toBe(200);
  expect((await get("/" + d.id + "/payouts", self)).status).toBe(200);
  expect((await get("/" + d.id, otherTeacher)).status).toBe(404);
  expect((await get("/summary", self)).status).toBe(403);
  expect(
    (
      await post("/preview", {
        teacherId,
        month: "2025-02",
        tenantId: String(tenant),
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await request(app)
        .post("/api/payroll/drafts")
        .set("Cookie", owner)
        .send({ teacherId, month: "2025-02", confirmed: true })
    ).status,
  ).toBe(403);
  expect((await request(app).get("/api/payroll")).status).toBe(401);
});
it("serializes overlapping rule creation and applies fixed defaults once across multiple assignments", async () => {
  const results = await Promise.all([
    rule({ salaryType: "fixed", percentage: null, fixedAmount: 1200 }),
    rule({ salaryType: "fixed", percentage: null, fixedAmount: 1200 }),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  await Group.create({
    tenantId: tenant,
    teacherId,
    name: "Ikki",
    courseName: "Kurs",
    capacity: 10,
    monthlyFee: 100,
    startDate: new Date("2025-01-15"),
  });
  expect((await preview()).body.grossSalary).toBe(1200);
  expect(
    (await post("/" + (await draft()).id + "/payouts", payout())).status,
  ).toBe(409);
});
it("uses group fixed override instead of the teacher fixed default when all groups are overridden", async () => {
  await rule({ salaryType: "fixed", percentage: null, fixedAmount: 1200 });
  await rule({
    groupId,
    salaryType: "fixed",
    percentage: null,
    fixedAmount: 700,
  });
  expect((await preview()).body.grossSalary).toBe(700);
});
it("loads all salary settings page resources with their initial query parameters", async () => {
  for (const path of [
    "/api/groups/teachers?page=1",
    "/api/groups?pageSize=100&page=1",
    "/api/payroll/rules?page=1",
  ]) {
    const r = await request(app).get(path).set("Cookie", owner);
    expect({ path, status: r.status, error: r.body.error }).toMatchObject({
      path,
      status: 200,
    });
  }
});
it("identifies salary rule validation fields rather than hiding them in a generic error", async () => {
  const invalidDay = await rule({ effectiveFrom: "2026-10-30" });
  expect(invalidDay.status).toBe(400);
  expect(invalidDay.body.error.fields.effectiveFrom).toContain(
    "Oy boshini tanlang.",
  );
  const invalidEnd = await rule({
    effectiveFrom: "2026-10-01",
    effectiveUntil: "2026-09-30",
  });
  expect(invalidEnd.status).toBe(400);
  expect(invalidEnd.body.error.fields.effectiveUntil).toContain(
    "Tugash sanasi boshlanish sanasidan oldin bo‘lmasin.",
  );
  const missingPercent = await rule({ percentage: null });
  expect(missingPercent.body.error.fields.percentage).toContain(
    "Foizni kiriting.",
  );
});
