import {
  PayrollRun,
  PayrollRunItem,
} from "../src/payroll-automation-models.js";
import {
  generatePayrollBatch,
  previousPayrollMonth,
  payrollDueAt,
  runPayrollScheduler,
} from "../src/payroll-automation.js";
import {
  NotificationJob,
  NotificationSettings,
} from "../src/notification-models.js";
import { TelegramIntegration } from "../src/telegram-models.js";
import { processNotification } from "../src/notifications.js";
import { TelegramDispatch } from "../src/telegram-models.js";
import { payrollReadyEligibility } from "../src/payroll-notifications.js";
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
import { createSession } from "../src/security.js";
import { percentageSalary } from "../src/payroll-calculation.js";
import { monthBounds } from "../src/billing-validation.js";
const origin = "http://localhost:5173";
const config = parseConfig({
  PAYROLL_SCHEDULER_SECRET: randomBytes(48).toString("base64url"),
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
    cookie: "softlans_session=" + (await createSession(user, config)),
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
    PayrollRun,
    PayrollRunItem,
    NotificationJob,
    NotificationSettings,
    TelegramIntegration,
    TelegramDispatch,
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

const auto = (month = "2025-02", cookie = owner, extra = {}) =>
  post("/automation/run", { month, confirmed: true, ...extra }, cookie);
it("uses Tashkent closing instants including leap years, year rollover and configurable grace", async () => {
  expect(previousPayrollMonth(new Date("2025-12-31T19:00:00Z"))).toBe(
    "2025-12",
  );
  expect(previousPayrollMonth(new Date("2024-02-29T19:00:00Z"))).toBe(
    "2024-02",
  );
  expect(payrollDueAt("2024-02", config).toISOString()).toBe(
    "2024-02-29T19:15:00.000Z",
  );
  expect(
    payrollDueAt("2025-12", {
      PAYROLL_CLOSE_DAY: 3,
      PAYROLL_CLOSE_TIME: "08:45",
    }).toISOString(),
  ).toBe("2026-01-03T03:45:00.000Z");
  expect(
    (await runPayrollScheduler(config, {}, new Date("2025-02-28T19:14:59Z")))
      .status,
  ).toBe("not_due");
  expect((await auto("2199-12")).body.error.code).toBe("PAYROLL_MONTH_OPEN");
});
it("automates actual prorated finalAmount with group overrides and late non-reversed collections", async () => {
  await rule({ salaryType: "billed", percentage: 50 });
  await charge({
    originalAmount: 1000,
    prorationAmount: 600,
    discountAmount: 100,
    finalAmount: 300,
  });
  const second = await Group.create({
    tenantId: tenant,
    teacherId,
    name: "Ikkinchi",
    courseName: "Kurs",
    capacity: 10,
    monthlyFee: 1000,
    startDate: "2025-01-01",
  });
  await rule({ groupId: second.id, salaryType: "collected", percentage: 25 });
  const old = await charge({ groupId: second._id, billingMonth: "2025-01" });
  await pay(old._id, 400, "2025-01-31T19:00:00Z");
  await pay(old._id, 900, "2025-02-28T19:00:00Z");
  const reversed = await pay(old._id, 600);
  await PaymentReversal.create({
    tenantId: tenant,
    paymentId: reversed._id,
    recordedBy: teacherId,
    reason: "Xato to‘lov",
  });
  expect((await auto()).status).toBe(200);
  const p = await Payroll.findOne({ teacherId });
  expect(p).toMatchObject({
    grossSalary: 250,
    finalSalary: 250,
    status: "draft",
    approvedAt: null,
    paidAmount: 0,
  });
  expect(
    p!.calculationBasis.lines.map((l: { salary: number }) => l.salary).sort(),
  ).toEqual([100, 150]);
  expect(
    p!.calculationBasis.lines.map((l: { groupName: string }) => l.groupName),
  ).toContain("Ikkinchi");
  expect(await SalaryPayout.countDocuments()).toBe(0);
  expect(
    await PayrollRunItem.countDocuments({
      status: "exception",
      code: "NO_SALARY_RULE",
    }),
  ).toBe(1);
});
it("keeps adjustments, approvals, historical payouts and audit history unchanged across concurrent retries", async () => {
  await rule({ salaryType: "fixed", percentage: null, fixedAmount: 1000 });
  const d = await draft();
  await post("/" + d.id + "/adjustments", {
    revision: 0,
    amount: -100,
    reason: "Tuzatish sababi",
  });
  const before = (await Payroll.findById(d.id))!.toObject();
  const results = await Promise.all([auto(), auto(), auto()]);
  expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
  expect((await Payroll.findById(d.id))!.toObject()).toEqual(before);
  await post("/" + d.id + "/approve", { confirmed: true, revision: 1 });
  await post("/" + d.id + "/payouts", payout(400));
  const approved = (await Payroll.findById(d.id))!.toObject();
  const payments = await SalaryPayout.find().lean();
  expect(approved).toMatchObject({
    status: "partially_paid",
    finalSalary: 900,
    paidAmount: 400,
  });
  expect(payments).toHaveLength(1);
  await auto();
  expect((await Payroll.findById(d.id))!.toObject()).toEqual(approved);
  expect(await SalaryPayout.find().lean()).toEqual(payments);
  expect(await PayrollAudit.countDocuments({ action: "draft_created" })).toBe(
    1,
  );
});
it("creates exactly one automated draft under scheduler/manual concurrency and persists resumable exceptions", async () => {
  await rule({ salaryType: "fixed", percentage: null, fixedAmount: 1000 });
  const ownerDoc = await User.findOne({
    tenantId: tenant,
    role: "business_owner",
  });
  await Promise.all([
    generatePayrollBatch(tenant, ownerDoc!._id, "2025-02", "scheduled"),
    auto(),
    post("/drafts", { teacherId, month: "2025-02", confirmed: true }),
  ]);
  expect(await Payroll.countDocuments({ teacherId })).toBe(1);
  const status = await get("/automation/status?month=2025-02");
  expect(status.body.run.status).toBe("exceptions");
  expect(
    status.body.items.find(
      (i: { code: string }) => i.code === "NO_SALARY_RULE",
    ),
  ).toBeTruthy();
  const missingTeacher = await User.findOne({
    tenantId: tenant,
    role: "teacher",
    _id: { $ne: teacherId },
  });
  await rule({
    teacherId: missingTeacher!.id,
    salaryType: "fixed",
    percentage: null,
    fixedAmount: 800,
  });
  expect((await auto()).body.status).toBe("completed");
  expect(
    await PayrollRunItem.countDocuments({
      tenantId: tenant,
      status: "exception",
    }),
  ).toBe(0);
  expect(await Payroll.countDocuments({ tenantId: tenant })).toBe(2);
});
it("surfaces uncovered groups and invalid/overlapping persisted rules instead of zero salary", async () => {
  const second = await Group.create({
    tenantId: tenant,
    teacherId,
    name: "Qoidasi yo‘q guruh",
    courseName: "Kurs",
    capacity: 10,
    monthlyFee: 1000,
    startDate: "2025-01-01",
  });
  await rule({ groupId, salaryType: "billed", percentage: 40 });
  await auto();
  expect(await Payroll.exists({ teacherId })).toBeNull();
  expect((await PayrollRunItem.findOne({ teacherId }))!.message).toContain(
    second.name,
  );
  const r = await SalaryRule.findOne({ teacherId });
  await SalaryRule.collection.updateOne(
    { _id: r!._id },
    { $set: { percentage: null } },
  );
  await auto();
  expect((await PayrollRunItem.findOne({ teacherId }))!.code).toBe(
    "INVALID_SALARY_SETTINGS",
  );
});
it("authenticates machine scheduler independently and keeps manual fallback tenant/RBAC/CSRF/MFA controls", async () => {
  for (const cookie of [self, admin, platform])
    expect((await auto("2025-02", cookie)).status).toBe(403);
  expect((await get("/automation/status?month=2025-02", self)).status).toBe(
    403,
  );
  expect(
    (
      await request(app)
        .post("/api/payroll/automation/run")
        .set("Cookie", owner)
        .send({ month: "2025-02", confirmed: true })
    ).status,
  ).toBe(403);
  expect(
    (await auto("2025-02", owner, { tenantId: String(tenant) })).status,
  ).toBe(400);
  const path = "/api/internal/payroll/run";
  expect(
    (await request(app).post(path).set("Cookie", owner).send({})).status,
  ).toBe(401);
  expect(
    (
      await request(app)
        .post(path)
        .query({ secret: config.PAYROLL_SCHEDULER_SECRET })
        .send({})
    ).status,
  ).toBe(401);
  const trigger = (body: object) =>
    request(app)
      .post(path)
      .set("Authorization", "Bearer " + config.PAYROLL_SCHEDULER_SECRET)
      .send(body);
  expect(
    (await trigger({ month: "2025-02", tenantId: String(tenant) })).status,
  ).toBe(400);
  await rule({ salaryType: "fixed", fixedAmount: 1000, percentage: null });
  const batch = await trigger({ month: "2025-02" });
  expect(batch.status).toBe(200);
  expect(batch.body.month).toBe("2025-02");
  expect(
    (await get("/automation/status?month=2025-02", other)).body.items,
  ).toEqual([]);
  const ownerDoc = await User.findOne({
    tenantId: tenant,
    role: "business_owner",
  });
  await User.updateOne({ _id: ownerDoc!._id }, { $set: { mfaEnabled: true } });
  expect((await auto()).status).toBe(401);
});
it("follows bounded teacher cursors after restart without duplicates", async () => {
  for (let n = 0; n < 11; n++) await actor("teacher", tenant);
  const first = await auto();
  expect(first.body.nextTeacher).toMatch(/^[a-f0-9]{24}$/);
  expect(await PayrollRunItem.countDocuments({ tenantId: tenant })).toBe(10);
  const last = await auto("2025-02", owner, {
    afterTeacher: first.body.nextTeacher,
  });
  expect(last.body.nextTeacher).toBeNull();
  expect(await PayrollRunItem.countDocuments({ tenantId: tenant })).toBe(13);
  await auto();
  expect(await PayrollRunItem.countDocuments({ tenantId: tenant })).toBe(13);
});
it("queues readiness once with consent and revalidates owner, tenant and disconnect before delivery", async () => {
  const ownerDoc = await User.findOne({
    tenantId: tenant,
    role: "business_owner",
  });
  const teachers = await User.find({ tenantId: tenant, role: "teacher" });
  for (const t of teachers)
    await rule({
      teacherId: t.id,
      salaryType: "fixed",
      percentage: null,
      fixedAmount: 1000,
    });
  await auto();
  expect(await NotificationJob.countDocuments({ kind: "payroll_ready" })).toBe(
    0,
  );
  const integration = await TelegramIntegration.create({
    tenantId: tenant,
    userId: ownerDoc!._id,
    status: "connected",
    telegramUserId: "123",
    chatId: "123",
    notificationPreferences: { enabled: true },
  });
  await Promise.all([auto(), auto()]);
  const jobs = await NotificationJob.find({ kind: "payroll_ready" }).select(
    "+reportText",
  );
  expect(jobs).toHaveLength(1);
  expect(jobs[0]!.reportText).toContain("2025-02");
  const day = new Date("2026-11-01T10:00:00+05:00");
  expect((await payrollReadyEligibility(jobs[0]!, day)).eligible).toBe(true);
  expect(
    (
      await payrollReadyEligibility(
        jobs[0]!,
        new Date("2026-11-01T00:15:00+05:00"),
      )
    ).quiet,
  ).toBe(true);
  await TelegramIntegration.updateOne(
    { _id: integration._id },
    { $set: { "notificationPreferences.enabled": false } },
  );
  expect((await payrollReadyEligibility(jobs[0]!, day)).eligible).toBe(false);
  await TelegramIntegration.updateOne(
    { _id: integration._id },
    { $set: { "notificationPreferences.enabled": true } },
  );
  await User.updateOne({ _id: ownerDoc!._id }, { active: false });
  expect((await payrollReadyEligibility(jobs[0]!, day)).eligible).toBe(false);
});
it("rejects reused scheduler credentials and invalid closing configuration", () => {
  for (const extra of [
    { PAYROLL_SCHEDULER_SECRET: config.JWT_SECRET },
    { PAYROLL_CLOSE_DAY: "29" },
    { PAYROLL_CLOSE_TIME: "24:00" },
  ])
    expect(() =>
      parseConfig({
        NODE_ENV: "test",
        APP_ORIGIN: origin,
        JWT_SECRET: config.JWT_SECRET,
        MONGODB_URI: "mongodb://localhost/test",
        ...extra,
      }),
    ).toThrow();
});

it("supports historical payrolls without the new source field and freezes completed scheduler runs", async () => {
  await rule({ salaryType: "fixed", percentage: null, fixedAmount: 1000 });
  const d = await draft();
  await Payroll.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(d.id) },
    { $unset: { generationSource: 1 } },
  );
  expect(
    (await post("/" + d.id + "/approve", { confirmed: true, revision: 0 }))
      .status,
  ).toBe(200);
  const otherT = await User.findOne({
    tenantId: tenant,
    role: "teacher",
    _id: { $ne: teacherId },
  });
  await rule({
    teacherId: otherT!.id,
    salaryType: "fixed",
    percentage: null,
    fixedAmount: 800,
  });
  await auto();
  const audits = await PayrollAudit.countDocuments();
  const result = await runPayrollScheduler(config, {
    month: "2025-02",
    cursor: { tenantId: String(tenant) },
  });
  expect(result.status).toBe("completed");
  expect(result.created).toBe(0);
  expect(await PayrollAudit.countDocuments()).toBe(audits);
});
it("records owner exceptions without blocking other tenants and ignores inactive teachers", async () => {
  await User.updateMany(
    { tenantId: tenant, role: "business_owner" },
    { active: false },
  );
  const result = await runPayrollScheduler(config, { month: "2025-02" });
  expect(result).toMatchObject({
    status: "exceptions",
    exceptions: 1,
    code: "PAYROLL_OWNER_REQUIRED",
  });
  expect((await PayrollRun.findOne({ tenantId: tenant }))!.code).toBe(
    "PAYROLL_OWNER_REQUIRED",
  );
  expect(result.nextCursor).toBeTruthy();
  await User.updateMany(
    { tenantId: tenant, role: "business_owner" },
    { active: true },
  );
  await User.updateMany(
    { tenantId: tenant, role: "teacher", _id: { $ne: teacherId } },
    { active: false },
  );
  await rule({ salaryType: "fixed", percentage: null, fixedAmount: 1000 });
  expect((await auto()).body.status).toBe("completed");
  expect(await Payroll.countDocuments({ tenantId: tenant })).toBe(1);
});

it("retains a visible exclusion when a previously failing teacher leaves eligibility", async () => {
  await rule({ salaryType: "fixed", percentage: null, fixedAmount: 1000 });
  expect((await auto()).body.status).toBe("exceptions");
  await User.updateMany(
    { tenantId: tenant, role: "teacher", _id: { $ne: teacherId } },
    { active: false },
  );
  expect((await auto()).body.status).toBe("completed");
  expect(
    await PayrollRunItem.countDocuments({
      status: "excluded",
      code: "TEACHER_INELIGIBLE",
    }),
  ).toBe(1);
  expect(await Payroll.countDocuments()).toBe(1);
});
it("delivers payroll readiness through the existing notification processor with a synthetic sender", async () => {
  const ownerDoc = await User.findOne({
    tenantId: tenant,
    role: "business_owner",
  });
  await TelegramIntegration.create({
    tenantId: tenant,
    userId: ownerDoc!._id,
    status: "connected",
    telegramUserId: "321",
    chatId: "321",
    notificationPreferences: { enabled: true },
  });
  for (const t of await User.find({ tenantId: tenant, role: "teacher" }))
    await rule({
      teacherId: t.id,
      salaryType: "fixed",
      percentage: null,
      fixedAmount: 1000,
    });
  await auto();
  await NotificationSettings.create({
    tenantId: tenant,
    quietStart: "00:00",
    quietEnd: "00:00",
  });
  const sent: string[] = [];
  const deliveryConfig = {
    ...config,
    TELEGRAM_BOT_TOKEN: "123456:synthetic-token-for-unit-tests",
    TELEGRAM_BOT_USERNAME: "synthetic_bot",
    TELEGRAM_WEBHOOK_SECRET: "synthetic-webhook-secret-for-tests-only-0000",
  };
  await processNotification(deliveryConfig, async (chat, text) => {
    sent.push(chat + ":" + text);
  });
  expect(sent).toHaveLength(1);
  expect(sent[0]).toContain("321:SoftLans Edu — 2025-02");
  expect(
    (await NotificationJob.findOne({ kind: "payroll_ready" }))!.status,
  ).toBe("sent");
});
