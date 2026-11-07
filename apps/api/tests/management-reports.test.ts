import { beforeAll, beforeEach, afterAll, it, expect } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { createApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import { connectDatabase } from "../src/db.js";
import { ensureIndexes, Tenant, User } from "../src/models.js";
import { createSession } from "../src/security.js";
import {
  cashModels,
  CashMovement,
  Expense,
  CashAccount,
  ExpenseCategory,
  CashAudit,
} from "../src/cash-models.js";
import {
  Charge,
  ChargeAdjustment,
  Payment,
  PaymentReversal,
} from "../src/billing-models.js";
import {
  Payroll,
  SalaryPayout,
  SalaryPayoutReversal,
  SalaryRule,
} from "../src/payroll-models.js";
import { Group } from "../src/group-models.js";
import {
  managementReport,
  managementInput,
  reportSum,
  managementCsv,
} from "../src/management-reports.js";
const config = parseConfig({
  NODE_ENV: "test",
  APP_ORIGIN: "http://localhost:5173",
  JWT_SECRET: randomBytes(48).toString("hex"),
  MONGODB_URI: "mongodb://localhost/unused-synthetic",
});
const app = createApp(config);
let repl: MongoMemoryReplSet,
  tenant: mongoose.Types.ObjectId,
  actor: mongoose.Types.ObjectId,
  account: mongoose.Types.ObjectId,
  category: mongoose.Types.ObjectId;
let cookie: string;
const id = () => new mongoose.Types.ObjectId();
const timestamp = new Date("2025-01-01T00:00:00Z");
const q = (start = "2025-02-01", end = "2025-02-28", asOf?: string) => ({
  start,
  end,
  ...(asOf ? { asOf } : {}),
});
const report = (start?: string, end?: string, asOf?: string) =>
  managementReport(tenant, q(start, end, asOf));
const get = (query = q(), auth = cookie) =>
  request(app).get("/api/management-reports").query(query).set("Cookie", auth);
async function movement(
  kind: string,
  delta: number,
  sourceId = randomUUID(),
  date = "2025-02-10",
  extra = {},
) {
  return CashMovement.create({
    tenantId: tenant,
    recordedBy: actor,
    accountId: account,
    delta,
    kind,
    sourceId,
    date,
    reason: "Sintetik",
    createdAt: timestamp,
    ...extra,
  });
}
async function charge(amount = 1000, extra = {}) {
  return Charge.create({
    tenantId: tenant,
    generatedBy: actor,
    studentId: id(),
    groupId: id(),
    billingMonth: "2025-02",
    originalAmount: amount,
    finalAmount: amount,
    dueDate: new Date("2025-02-10"),
    createdAt: timestamp,
    ...extra,
  });
}
async function payroll(extra = {}) {
  return Payroll.create({
    tenantId: tenant,
    teacherId: actor,
    createdBy: actor,
    payrollMonth: "2025-02",
    grossSalary: 300,
    finalSalary: 300,
    calculationBasis: {},
    calculatedAt: timestamp,
    status: "approved",
    approvedAt: timestamp,
    createdAt: timestamp,
    ...extra,
  });
}
async function payment(
  c: Awaited<ReturnType<typeof charge>>,
  amount = 400,
  date = "2025-02-10T10:00:00Z",
  allocated = true,
) {
  const p = await Payment.create({
    tenantId: tenant,
    chargeId: c._id,
    studentId: c.studentId,
    recordedBy: actor,
    amount,
    method: "cash",
    paidAt: new Date(date),
    idempotencyKey: randomUUID(),
    fingerprint: "synthetic",
    createdAt: timestamp,
  });
  if (allocated) await movement("payment", amount, p.id, date.slice(0, 10));
  return p;
}
async function expense(
  classification?: string,
  date = "2025-02-10",
  amount = 100,
) {
  const e = await Expense.create({
    tenantId: tenant,
    createdBy: actor,
    categoryId: category,
    categoryName: "Sinov ijara",
    accountId: account,
    amount,
    description: "Sintetik",
    expenseDate: date,
    method: "cash",
    status: "confirmed",
    createdAt: timestamp,
    ...(classification ? { accountingClassification: classification } : {}),
  });
  await movement("expense", -amount, e.id, date);
  return e;
}
beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: "7.0.24" },
  });
  await connectDatabase(repl.getUri("management-report-disposable-only"));
  await ensureIndexes();
}, 180000);
afterAll(async () => {
  await mongoose.disconnect();
  await repl?.stop();
});
beforeEach(async () => {
  for (const model of [
    ...cashModels,
    Charge,
    ChargeAdjustment,
    Payment,
    PaymentReversal,
    Payroll,
    SalaryRule,
    SalaryPayout,
    SalaryPayoutReversal,
    Group,
    User,
    Tenant,
  ])
    await model.collection.deleteMany({});
  tenant = (await Tenant.create({ name: "Sintetik markaz" }))._id;
  const user = await User.create({
    tenantId: tenant,
    role: "business_owner",
    name: "Sinov",
    email: "owner@example.test",
    passwordHash: "unused",
  });
  actor = user._id;
  cookie = "softlans_session=" + (await createSession(user, config));
  account = (
    await CashAccount.create({
      tenantId: tenant,
      createdBy: actor,
      name: "Sinov kassa",
      kind: "cash",
      openingDate: "2025-01-01",
      createdAt: timestamp,
    })
  )._id;
  category = (
    await ExpenseCategory.create({
      tenantId: tenant,
      createdBy: actor,
      name: "Sinov kategoriya",
    })
  )._id;
  await movement("opening", 5000, String(account), "2025-01-01");
});
it("separates prorated final tuition, partial receipts, approved unpaid salary and actual cash without double counting", async () => {
  const c = await charge(1000, {
    originalAmount: 2000,
    prorationAmount: 800,
    discountAmount: 200,
  });
  await payment(c);
  await payroll();
  await expense("operating");
  const result = await report();
  expect(result.summary).toMatchObject({
    billed: 1000,
    receipts: 400,
    debt: 600,
    approvedSalary: 300,
    salaryPaid: 0,
    operatingExpenses: 100,
    estimatedResult: 600,
  });
  expect(result.cash).toMatchObject({
    opening: 5000,
    tuition: 400,
    salary: 0,
    expenses: -100,
    transfers: 0,
    closing: 5300,
  });
  expect(result.groups[0]).toMatchObject({ billed: 1000, receipts: 400 });
});
it("keeps late-month collections out of the original billing month and uses Tashkent midnight", async () => {
  const c = await charge();
  await payroll();
  await payment(c, 250, "2025-02-28T18:59:59.999Z", false);
  await payment(c, 150, "2025-02-28T19:00:00Z", false);
  const feb = await report(),
    mar = await report("2025-03-01", "2025-03-31");
  expect(feb.summary).toMatchObject({ billed: 1000, receipts: 250, debt: 750 });
  expect(mar.summary).toMatchObject({ billed: 0, receipts: 150, debt: 600 });
  expect(feb.cash.tuition).toBe(0);
  expect(mar.unallocated.payments).toEqual({ count: 2, amount: 400 });
});
it("keeps payment and salary reversal dates in correction periods, including partial payouts", async () => {
  const c = await charge(),
    p = await payment(c),
    salary = await payroll();
  const payout = await SalaryPayout.create({
    tenantId: tenant,
    payrollId: salary._id,
    recordedBy: actor,
    amount: 120,
    paidAt: new Date("2025-02-10T00:00:00+05:00"),
    method: "cash",
    idempotencyKey: randomUUID(),
    fingerprint: "synthetic",
    createdAt: timestamp,
  });
  await movement("salary", -120, payout.id);
  await PaymentReversal.create({
    tenantId: tenant,
    recordedBy: actor,
    paymentId: p._id,
    reason: "Sinov",
    createdAt: new Date("2025-03-01T00:00:00+05:00"),
  });
  await SalaryPayoutReversal.create({
    tenantId: tenant,
    recordedBy: actor,
    payoutId: payout._id,
    reason: "Sinov",
    createdAt: new Date("2025-03-01T00:00:00+05:00"),
  });
  await movement("payment_reversal", -400, p.id, "2025-03-01");
  await movement("salary_reversal", 120, payout.id, "2025-03-01");
  expect((await report()).summary).toMatchObject({
    receipts: 400,
    salaryPaid: 120,
    approvedSalary: 300,
    debt: 600,
  });
  expect((await report("2025-03-01", "2025-03-31")).summary).toMatchObject({
    receipts: -400,
    salaryPaid: -120,
    debt: 1000,
  });
  expect((await report("2025-03-01", "2025-03-31")).cash).toMatchObject({
    tuition: -400,
    salary: 120,
    opening: 5280,
    closing: 5000,
  });
});
it("preserves original expense month and corrects a cross-month void only in the void period", async () => {
  await charge();
  await payroll();
  const e = await expense("operating");
  e.status = "voided";
  await e.save();
  await movement("expense_void", 100, e.id, "2025-03-03");
  expect((await report()).summary).toMatchObject({
    operatingExpenses: 100,
    estimatedResult: 600,
  });
  expect(
    (await report("2025-03-01", "2025-03-31")).summary.operatingExpenses,
  ).toBe(-100);
  expect((await report()).cash.expenses).toBe(-100);
});
it("treats equipment and prepayments as non-operating, and never guesses historical categories", async () => {
  await charge();
  await payroll();
  await expense("capital");
  await expense("prepayment");
  expect((await report()).summary).toMatchObject({
    operatingExpenses: 0,
    estimatedResult: 700,
  });
  await ExpenseCategory.updateOne(
    { _id: category },
    { $set: { accountingClassification: "operating" } },
  );
  await expense();
  const r = await report();
  expect(r.summary).toMatchObject({
    unclassifiedExpenses: 1,
    estimatedResult: null,
  });
  expect(r.warnings.some((w) => w.code === "EXPENSE_UNCLASSIFIED")).toBe(true);
});
it("excludes drafts from expense and payroll totals and suppresses incomplete results", async () => {
  await charge();
  await payroll({ status: "draft", approvedAt: null });
  await Expense.create({
    tenantId: tenant,
    createdBy: actor,
    categoryId: category,
    accountId: account,
    amount: 200,
    description: "Draft",
    expenseDate: "2025-02-03",
    method: "cash",
  });
  const r = await report();
  expect(r.summary).toMatchObject({
    approvedSalary: 0,
    salaryPaid: 0,
    operatingExpenses: 0,
    estimatedResult: null,
  });
  expect(r.warnings.map((w) => w.code)).toEqual(
    expect.arrayContaining(["PAYROLL_APPROVAL", "EXPENSE_DRAFT"]),
  );
});
it("detects missing payroll even when another teacher has an approved payroll", async () => {
  await charge();
  await payroll();
  await SalaryRule.create({
    tenantId: tenant,
    teacherId: id(),
    salaryType: "fixed",
    fixedAmount: 100,
    effectiveFrom: "2025-02-01",
    createdBy: actor,
  });
  expect(
    (await report()).warnings.some((w) => w.code === "PAYROLL_MISSING"),
  ).toBe(true);
  expect((await report()).summary.estimatedResult).toBeNull();
});
it("keeps opening entries and transfers out of revenue, reverses both legs and labels manual loan-like receipts unknown", async () => {
  await charge();
  await payroll();
  const bank = await CashAccount.create({
    tenantId: tenant,
    createdBy: actor,
    name: "Bank",
    kind: "bank",
    createdAt: timestamp,
  });
  await movement("opening", 1000, bank.id, "2025-02-01", {
    accountId: bank._id,
  });
  const source = randomUUID();
  await movement("transfer", -500, source);
  await movement("transfer", 500, source, "2025-02-10", {
    accountId: bank._id,
  });
  let r = await report();
  expect(r.summary.receipts).toBe(0);
  expect(r.cash).toMatchObject({
    opening: 5000,
    openingEntries: 1000,
    transfers: 0,
    closing: 6000,
  });
  await movement("movement_void", 500, source, "2025-02-11");
  await movement("movement_void", -500, source, "2025-02-11", {
    accountId: bank._id,
  });
  await movement("manual_in", 900, "loan");
  r = await report();
  expect(r.cash).toMatchObject({ manual: 900, transfers: 0, closing: 6900 });
  expect(r.summary).toMatchObject({
    receipts: 0,
    estimatedResult: null,
    unclassifiedMovements: 1,
  });
});
it("never allocates historical payments or payouts into cash", async () => {
  const c = await charge(),
    salary = await payroll();
  await payment(c, 200, undefined, false);
  await SalaryPayout.create({
    tenantId: tenant,
    payrollId: salary._id,
    recordedBy: actor,
    amount: 80,
    paidAt: new Date("2025-02-10"),
    method: "cash",
    idempotencyKey: randomUUID(),
    fingerprint: "synthetic",
    createdAt: timestamp,
  });
  const r = await report();
  expect(r.unallocated).toEqual({
    payments: { count: 1, amount: 200 },
    salaries: { count: 1, amount: 80 },
  });
  expect(r.cash.closing).toBe(5000);
  expect(r.summary).toMatchObject({ receipts: 200, salaryPaid: 80 });
});
it("fails closed on orphaned cash sources, missing accounts and broken transfers", async () => {
  await charge();
  await payroll();
  await movement("payment", 100, String(id()));
  await movement("transfer", -100);
  await movement("manual_in", 20, "orphan-account", undefined, {
    accountId: id(),
  });
  const r = await report();
  expect(r.summary.estimatedResult).toBeNull();
  expect(r.warnings.map((w) => w.code)).toEqual(
    expect.arrayContaining([
      "CASH_SOURCE",
      "CASH_ACCOUNT",
      "TRANSFER_RECONCILIATION",
    ]),
  );
});
it("returns zero observed values but no definitive profit for empty months", async () => {
  const r = await report();
  expect(r.summary).toMatchObject({
    billed: 0,
    receipts: 0,
    approvedSalary: 0,
    estimatedResult: null,
  });
  expect(r.monthly).toHaveLength(1);
  expect(r.warnings.some((w) => w.code === "BILLING_COVERAGE")).toBe(true);
});
it("pins immutable cash, charge adjustment state and approval cutoff for reproducible as-of reporting", async () => {
  const c = await charge(800);
  await payroll({ approvedAt: new Date("2025-03-05") });
  await ChargeAdjustment.create({
    tenantId: tenant,
    chargeId: c._id,
    recordedBy: actor,
    reason: "Sinov",
    before: { finalAmount: 1000, cancelled: false },
    after: { finalAmount: 800, cancelled: false },
    createdAt: new Date("2025-03-02"),
  });
  const p = await payment(c);
  await CashMovement.collection.updateOne(
    { sourceId: p.id },
    { $set: { createdAt: new Date("2025-03-02") } },
  );
  const historical = await report(
    undefined,
    undefined,
    "2025-02-28T23:59:59+05:00",
  );
  expect(historical.summary).toMatchObject({
    billed: 1000,
    approvedSalary: 0,
    estimatedResult: null,
  });
  expect(historical.cash.tuition).toBe(0);
  const current = await report();
  expect(current.summary).toMatchObject({ billed: 800, approvedSalary: 300 });
  expect(current.cash.tuition).toBe(400);
  expect(await report(undefined, undefined, historical.period.asOf)).toEqual(
    historical,
  );
});
it("uses safe signed arithmetic, rejects invalid money and overflow rather than rounding", async () => {
  expect(
    reportSum([Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER, 7]),
  ).toBe(7);
  for (const values of [
    [Number.MAX_SAFE_INTEGER, 1],
    [-Number.MAX_SAFE_INTEGER, -1],
    [1.5],
    [NaN],
  ])
    expect(() => reportSum(values)).toThrow();
  await charge(Number.MAX_SAFE_INTEGER);
  await charge(1);
  await payroll();
  expect((await get()).status).toBe(422);
});
it("enforces strict tenant/RBAC, authentication, MFA, session revocation and read-only report semantics", async () => {
  await charge();
  await payroll();
  for (const role of ["admin", "teacher", "super_admin"] as const) {
    const user = await User.create({
      tenantId: role === "super_admin" ? null : tenant,
      role,
      name: role,
      email: role + "@example.test",
      passwordHash: "unused",
    });
    const auth = "softlans_session=" + (await createSession(user, config));
    expect((await get(q(), auth)).status).toBe(403);
    expect(
      (
        await request(app)
          .get("/api/management-reports/export")
          .query(q())
          .set("Cookie", auth)
      ).status,
    ).toBe(403);
  }
  const otherTenant = await Tenant.create({ name: "Other" });
  const user = await User.create({
    tenantId: otherTenant._id,
    role: "business_owner",
    name: "Other",
    email: "other@example.test",
    passwordHash: "unused",
  });
  const r = await get(
    q(),
    "softlans_session=" + (await createSession(user, config)),
  );
  expect(r.body.summary.billed).toBe(0);
  expect(r.body.cash.accounts).toHaveLength(0);
  expect(
    (await request(app).get("/api/management-reports").query(q())).status,
  ).toBe(401);
  expect((await get({ ...q(), tenantId: String(tenant) } as any)).status).toBe(
    400,
  );
  await User.updateOne({ _id: actor }, { $set: { mfaEnabled: true } });
  expect((await get()).status).toBe(401);
  const fresh = await User.findById(actor).select(
    "+sessionVersion +mfaEnabled",
  );
  cookie =
    "softlans_session=" +
    (await createSession(fresh!, config, undefined, true));
  const count = await CashMovement.countDocuments();
  expect((await get()).status).toBe(200);
  expect(await CashMovement.countDocuments()).toBe(count);
  await User.updateOne({ _id: actor }, { $inc: { sessionVersion: 1 } });
  expect((await get()).status).toBe(401);
});
it("validates period boundaries and exports cutoff, limitations, warnings and actual cash separately", async () => {
  expect(managementInput.safeParse(q("2025-02-30")).success).toBe(false);
  expect(managementInput.safeParse(q("2024-01-01", "2025-02-01")).success).toBe(
    false,
  );
  expect(
    managementInput.safeParse(q(undefined, undefined, "2025-02-01T00:00:00Z"))
      .success,
  ).toBe(false);
  const csv = managementCsv(await report());
  expect(csv).toContain("Ma’lumot yetarli emas");
  expect(csv).toContain("sertifikatlangan foyda emas");
  expect(csv).toContain("Qayd chegarasi");
  const r = await request(app)
    .get("/api/management-reports/export")
    .query(q())
    .set("Cookie", cookie);
  expect(r.status).toBe(200);
  expect(r.headers["cache-control"]).toBe("no-store");
  expect(r.headers["content-type"]).toContain("text/csv");
});
it("snapshots only new expense classifications, requires owner permission and audits future-default changes", async () => {
  const categoryPath = `/api/cash/categories/${category}`;
  const patch = (classification: string) =>
    request(app)
      .patch(categoryPath)
      .set("Cookie", cookie)
      .set("Origin", config.APP_ORIGIN)
      .send({
        name: "Sinov kategoriya",
        active: true,
        accountingClassification: classification,
        reason: "Yangi qoralamalar uchun",
        idempotencyKey: randomUUID(),
      });
  const draft = () =>
    request(app)
      .post("/api/cash/expenses")
      .set("Cookie", cookie)
      .set("Origin", config.APP_ORIGIN)
      .send({
        amount: 70,
        categoryId: String(category),
        accountId: String(account),
        description: "Sintetik ijara",
        expenseDate: "2025-02-10",
        method: "cash",
        idempotencyKey: randomUUID(),
      });
  expect((await patch("capital")).status).toBe(200);
  const first = await draft();
  expect(first.status).toBe(201);
  expect(first.body.expense.accountingClassification).toBe("capital");
  expect((await patch("operating")).status).toBe(200);
  expect((await draft()).body.expense.accountingClassification).toBe(
    "operating",
  );
  expect(
    (await Expense.findById(first.body.expense.id))!.accountingClassification,
  ).toBe("capital");
  expect(
    await CashAudit.countDocuments({
      entityId: String(category),
      action: "categories_updated",
    }),
  ).toBe(2);
});
it("excludes cancelled charges and withholds results only for incomplete edge months", async () => {
  await charge(900, { cancelled: true });
  await charge();
  await payroll();
  expect((await report()).summary.billed).toBe(1000);
  const r = await report("2025-02-10", "2025-02-28");
  expect(r.summary.estimatedResult).toBeNull();
  expect(
    r.warnings.some((w) => w.code === "PARTIAL_MONTH" && w.month === "2025-02"),
  ).toBe(true);
});
it("returns exact large valid amounts without rounding", async () => {
  const c = await charge(1_000_000_000_001);
  await payment(c, 1_000_000_000_000);
  await payroll();
  const r = await report();
  expect(r.summary.debt).toBe(1);
  expect(r.summary.estimatedResult).toBe(999_999_999_701);
  expect(r.cash.closing).toBe(1_000_000_005_000);
});
it("fails closed when a historical cash source exceeds the bounded report limit", async () => {
  await CashMovement.insertMany(
    Array.from({ length: 20000 }, (_, index) => ({
      tenantId: tenant,
      recordedBy: actor,
      accountId: account,
      delta: 0,
      date: "2025-01-02",
      kind: "manual_in",
      sourceId: `synthetic-limit-${index}`,
      reason: "Disposable limit fixture",
    })),
  );
  await expect(report()).rejects.toMatchObject({ code: "REPORT_LIMIT" });
}, 30000);
it("does not count inconsistent draft sources even if stray approval or cash metadata exists", async () => {
  await charge();
  await payroll({ status: "draft" });
  const e = await Expense.create({
    tenantId: tenant,
    createdBy: actor,
    categoryId: category,
    accountId: account,
    amount: 100,
    description: "Synthetic inconsistent draft",
    expenseDate: "2025-02-10",
    method: "cash",
    status: "draft",
    accountingClassification: "operating",
    createdAt: timestamp,
  });
  await movement("expense", -100, e.id);
  const r = await report();
  expect(r.summary).toMatchObject({
    approvedSalary: 0,
    operatingExpenses: 0,
    estimatedResult: null,
  });
});
it("reconstructs actual billing PATCH audit views with status rather than a fabricated cancelled field", async () => {
  const c = await charge();
  await payroll();
  const asOf = new Date(Date.now() - 1).toISOString();
  const response = await request(app)
    .patch(`/api/billing/charges/${c.id}`)
    .set("Cookie", cookie)
    .set("Origin", config.APP_ORIGIN)
    .send({
      originalAmount: 800,
      discountAmount: 0,
      cancelled: true,
      reason: "Sintetik tuzatish",
    });
  expect(response.status).toBe(200);
  const audit = await ChargeAdjustment.findOne({ chargeId: c._id });
  expect(audit!.before.status).toBe("unpaid");
  expect(audit!.before.cancelled).toBeUndefined();
  expect((await report(undefined, undefined, asOf)).summary.billed).toBe(1000);
  expect((await report()).summary.billed).toBe(0);
});
it("attributes early receipts for future tuition without counting future charges in current billing or debt", async () => {
  const c = await charge(1000, { billingMonth: "2025-03" });
  await payment(c);
  await payroll();
  const r = await report();
  expect(r.summary).toMatchObject({ billed: 0, receipts: 400, debt: 0 });
  expect(r.groups[0]).toMatchObject({ billed: 0, receipts: 400 });
  expect(r.warnings.some((w) => w.code === "PAYMENT_SOURCE")).toBe(false);
  expect((await report("2025-03-01", "2025-03-31")).summary).toMatchObject({
    billed: 1000,
    receipts: 0,
    debt: 600,
  });
});
