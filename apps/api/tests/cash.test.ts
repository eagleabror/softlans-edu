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
  CashAudit,
  CashAccount,
  ExpenseCategory,
} from "../src/cash-models.js";
import { Charge, Payment, PaymentReversal } from "../src/billing-models.js";
import {
  Payroll,
  SalaryPayout,
  SalaryPayoutReversal,
} from "../src/payroll-models.js";
import { cashDay, exactSum } from "../src/cash-service.js";
const origin = "http://localhost:5173";
const config = parseConfig({
  NODE_ENV: "test",
  APP_ORIGIN: origin,
  JWT_SECRET: randomBytes(48).toString("hex"),
  MONGODB_URI: "mongodb://localhost/synthetic-cash",
});
const app = createApp(config);
let repl: MongoMemoryReplSet, tenant: mongoose.Types.ObjectId, userId: string;
let owner: string,
  admin: string,
  teacher: string,
  platform: string,
  other: string;
let account: string, bank: string, category: string;
const confirm = (extra = {}) => ({
  confirmed: true,
  idempotencyKey: randomUUID(),
  reason: "Sintetik sinov sababi",
  ...extra,
});
const get = (path: string, cookie = owner) =>
  request(app)
    .get("/api/cash" + path)
    .set("Cookie", cookie);
const post = (path: string, body: object, cookie = owner) =>
  request(app)
    .post("/api/cash" + path)
    .set("Cookie", cookie)
    .set("Origin", origin)
    .send(body);
const patch = (path: string, body: object) =>
  request(app)
    .patch("/api/cash" + path)
    .set("Cookie", owner)
    .set("Origin", origin)
    .send(body);
async function actor(
  role: "business_owner" | "admin" | "teacher" | "super_admin",
  tenantId: mongoose.Types.ObjectId | null,
) {
  const u = await User.create({
    role,
    tenantId,
    name: "Sintetik sinov",
    email: randomUUID() + "@example.test",
    passwordHash: "unused",
  });
  return {
    id: u.id as string,
    cookie: "softlans_session=" + (await createSession(u, config)),
  };
}
const draftData = (extra = {}) => ({
  amount: 400,
  categoryId: category,
  accountId: account,
  description: "Sintetik ijara",
  expenseDate: "2025-02-10",
  method: "cash",
  idempotencyKey: randomUUID(),
  ...extra,
});
async function draft(extra = {}, cookie = owner) {
  const r = await post("/expenses", draftData(extra), cookie);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.expense;
}
const move = (extra = {}) =>
  post(
    "/movements",
    confirm({
      kind: "transfer",
      accountId: account,
      toAccountId: bank,
      amount: 100,
      date: "2025-02-10",
      ...extra,
    }),
  );
async function balances(day = cashDay()) {
  const r = await get("/daily?date=" + day);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
}
const sourcePost = (path: string, body: object) =>
  request(app)
    .post("/api" + path)
    .set("Cookie", owner)
    .set("Origin", origin)
    .send(body);
beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: "7.0.24" },
  });
  await connectDatabase(repl.getUri("synthetic-expenses-cash"));
  await ensureIndexes();
}, 180000);
afterAll(async () => {
  await mongoose.disconnect();
  await repl?.stop();
});
beforeEach(async () => {
  // Raw collection cleanup is limited to this disposable, locally created replica set.
  for (const m of [
    ...cashModels,
    Charge,
    Payment,
    PaymentReversal,
    Payroll,
    SalaryPayout,
    SalaryPayoutReversal,
    User,
    Tenant,
  ])
    await m.collection.deleteMany({});
  tenant = (await Tenant.create({ name: "Sintetik markaz" }))._id;
  const u = await actor("business_owner", tenant);
  owner = u.cookie;
  userId = u.id;
  admin = (await actor("admin", tenant)).cookie;
  teacher = (await actor("teacher", tenant)).cookie;
  platform = (await actor("super_admin", null)).cookie;
  other = (
    await actor(
      "business_owner",
      (await Tenant.create({ name: "Boshqa sintetik markaz" }))._id,
    )
  ).cookie;
  expect((await post("/setup", confirm())).status).toBe(200);
  const accounts = (await get("/accounts")).body.rows;
  account = accounts.find((a: { kind: string }) => a.kind === "cash").id;
  bank = accounts.find((a: { kind: string }) => a.kind === "bank").id;
  category = (await get("/categories")).body.rows[0].id;
  for (const id of [account, bank])
    expect(
      (
        await post(
          `/accounts/${id}/opening`,
          confirm({ amount: 1000, date: "2025-02-01" }),
        )
      ).status,
    ).toBe(200);
});
it("creates replayable drafts without money movement; confirms and voids once with immutable history", async () => {
  const data = draftData();
  const [a, b] = await Promise.all([
    post("/expenses", data),
    post("/expenses", data),
  ]);
  expect(a.body.expense.id).toBe(b.body.expense.id);
  expect(await Expense.countDocuments()).toBe(1);
  expect(await CashMovement.countDocuments({ kind: "expense" })).toBe(0);
  const id = a.body.expense.id,
    q = confirm();
  const results = await Promise.all([
    post(`/expenses/${id}/confirm`, q),
    post(`/expenses/${id}/confirm`, q),
  ]);
  expect(results.every((r) => r.status === 200)).toBe(true);
  expect(await CashMovement.countDocuments({ kind: "expense" })).toBe(1);
  expect(
    (await balances()).rows.find((r: { id: string }) => r.id === account)
      .confirmedBalance,
  ).toBe(600);
  expect((await post(`/expenses/${id}/confirm`, confirm())).status).toBe(409);
  const v = confirm();
  expect((await post(`/expenses/${id}/void`, v)).status).toBe(200);
  expect((await post(`/expenses/${id}/void`, v)).status).toBe(200);
  expect((await get(`/expenses/${id}`)).body.expense.status).toBe("voided");
  expect((await get(`/expenses/${id}`)).body.audit).toHaveLength(5);
  expect(await CashMovement.countDocuments({ kind: "expense_void" })).toBe(1);
  expect(
    (await balances()).rows.find((r: { id: string }) => r.id === account)
      .confirmedBalance,
  ).toBe(1000);
});
it("retains categories with history, audits renaming and blocks confirmation after deactivation", async () => {
  const e = await draft();
  expect(
    (
      await patch(`/categories/${category}`, {
        name: "Yangi nom",
        active: false,
        reason: "Vaqtincha yopildi",
        idempotencyKey: randomUUID(),
      })
    ).status,
  ).toBe(200);
  expect((await post(`/expenses/${e.id}/confirm`, confirm())).status).toBe(409);
  expect(await ExpenseCategory.exists({ _id: category })).toBeTruthy();
  expect(
    (
      await request(app)
        .delete(`/api/cash/categories/${category}`)
        .set("Cookie", owner)
        .set("Origin", origin)
        .send({})
    ).status,
  ).toBe(404);
  expect(await CashAudit.countDocuments({ entityId: category })).toBe(2);
  expect(
    (
      await post("/categories", {
        name: "Maxsus xarajat",
        reason: "Yangi tur",
        idempotencyKey: randomUUID(),
      })
    ).status,
  ).toBe(201);
});
it("sets opening once, replays safely, disallows dates before opening and rolls back invalid transfers", async () => {
  expect(
    (
      await post(
        `/accounts/${account}/opening`,
        confirm({ amount: 100, date: "2025-02-01" }),
      )
    ).status,
  ).toBe(409);
  const a = await post("/accounts", {
    name: "Qo‘shimcha hisob",
    kind: "manual",
    reason: "Sinov hisobi",
    idempotencyKey: randomUUID(),
  });
  const id = a.body.row.id;
  expect((await move({ toAccountId: id })).status).toBe(409);
  expect(await CashMovement.countDocuments({ kind: "transfer" })).toBe(0);
  const q = confirm({ amount: 0, date: "2025-02-01" });
  expect((await post(`/accounts/${id}/opening`, q)).status).toBe(200);
  expect((await post(`/accounts/${id}/opening`, q)).status).toBe(200);
  expect((await move({ date: "2025-01-31" })).status).toBe(409);
});
it("transfers atomically, deduplicates concurrent requests and never adds revenue", async () => {
  const key = randomUUID();
  const results = await Promise.all([
    move({ idempotencyKey: key }),
    move({ idempotencyKey: key }),
  ]);
  expect(results.every((r) => r.status === 201)).toBe(true);
  expect(await CashMovement.countDocuments({ kind: "transfer" })).toBe(2);
  expect(
    (await CashMovement.find({ kind: "transfer" })).reduce(
      (s, m) => s + m.delta,
      0,
    ),
  ).toBe(0);
  expect(await Payment.countDocuments()).toBe(0);
  expect((await move({ idempotencyKey: key, amount: 101 })).status).toBe(409);
  const rows = (await balances()).rows;
  expect(
    rows.find((r: { id: string }) => r.id === account).confirmedBalance,
  ).toBe(900);
  expect(rows.find((r: { id: string }) => r.id === bank).confirmedBalance).toBe(
    1100,
  );
  const m = await CashMovement.findOne({ kind: "transfer" });
  const q = confirm();
  expect((await post(`/movements/${m!.id}/void`, q)).status).toBe(200);
  expect((await post(`/movements/${m!.id}/void`, q)).status).toBe(200);
  expect(await CashMovement.countDocuments({ kind: "movement_void" })).toBe(2);
});
it("serializes separate concurrent transfers without losing money", async () => {
  const results = await Promise.all(Array.from({ length: 4 }, () => move()));
  expect(results.every((r) => r.status === 201)).toBe(true);
  const rows = (await balances()).rows;
  expect(
    rows.find((r: { id: string }) => r.id === account).confirmedBalance,
  ).toBe(600);
  expect(rows.find((r: { id: string }) => r.id === bank).confirmedBalance).toBe(
    1400,
  );
});
it("validates integer amounts, dates, method and same-account transfers", async () => {
  for (const amount of [0, -1, 1.5, Number.MAX_SAFE_INTEGER, "100"])
    expect((await move({ amount })).status).toBe(400);
  expect((await move({ toAccountId: account })).status).toBe(409);
  expect((await move({ date: "2025-02-30" })).status).toBe(400);
  expect((await move({ date: "2199-01-01" })).status).toBe(400);
  const d = await draft({ method: "bank_transfer" });
  expect((await post(`/expenses/${d.id}/confirm`, confirm())).status).toBe(409);
  expect(exactSum([Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER, 7])).toBe(
    7,
  );
  expect(() => exactSum([Number.MAX_SAFE_INTEGER, 1])).toThrow();
});
it("preserves exact large UZS amounts", async () => {
  const e = await draft({ amount: 1_000_000_000_000 });
  expect((await post(`/expenses/${e.id}/confirm`, confirm())).status).toBe(200);
  expect(
    (await balances()).rows.find((r: { id: string }) => r.id === account)
      .confirmedBalance,
  ).toBe(-999999999000);
});
it("enforces teacher/platform exclusion, admin own-draft visibility and owner-only balances", async () => {
  for (const c of [teacher, platform])
    for (const path of ["/expenses", "/daily", "/draft-options"])
      expect((await get(path, c)).status).toBe(403);
  const mine = await draft({}, admin),
    theirs = await draft();
  expect(
    (await get("/expenses", admin)).body.rows.map((e: { id: string }) => e.id),
  ).toEqual([mine.id]);
  expect((await get(`/expenses/${theirs.id}`, admin)).status).toBe(404);
  for (const path of ["/daily", "/accounts", "/categories", "/movements"])
    expect((await get(path, admin)).status).toBe(403);
  expect(
    (await post(`/expenses/${mine.id}/confirm`, confirm(), admin)).status,
  ).toBe(403);
  expect(
    (await get("/draft-options", admin)).body.accounts[0],
  ).not.toHaveProperty("openingDate");
  await post(`/expenses/${mine.id}/confirm`, confirm());
  expect((await get(`/expenses/${mine.id}`, admin)).status).toBe(404);
  expect((await request(app).get("/api/cash/expenses")).status).toBe(401);
  expect(
    (
      await request(app)
        .post("/api/cash/expenses")
        .set("Cookie", owner)
        .send(draftData())
    ).status,
  ).toBe(403);
});
it("rejects cross-tenant references and input tenant injection", async () => {
  const e = await draft();
  expect((await get(`/expenses/${e.id}`, other)).status).toBe(404);
  expect(
    (await post(`/expenses/${e.id}/confirm`, confirm(), other)).status,
  ).toBe(404);
  expect((await post("/expenses", draftData(), other)).status).toBe(404);
  expect(
    (await post("/expenses", draftData({ tenantId: String(tenant) }))).status,
  ).toBe(400);
  expect(
    (
      await post(
        "/movements",
        confirm({
          kind: "transfer",
          accountId: account,
          toAccountId: bank,
          amount: 10,
          date: "2025-02-10",
        }),
        other,
      )
    ).status,
  ).toBe(404);
});
async function charge() {
  return Charge.create({
    tenantId: tenant,
    generatedBy: userId,
    studentId: new mongoose.Types.ObjectId(),
    groupId: new mongoose.Types.ObjectId(),
    billingMonth: "2025-02",
    originalAmount: 1000,
    finalAmount: 1000,
    dueDate: new Date("2025-02-10"),
  });
}
const paymentBody = (chargeId: string, extra = {}) => ({
  chargeId,
  amount: 300,
  method: "cash",
  paidAt: "2025-02-09T19:00:00Z",
  idempotencyKey: randomUUID(),
  confirmed: true,
  ...extra,
});
it("allocates NEW payments once, reverses atomically and preserves old data", async () => {
  const c = await charge();
  expect(await CashMovement.countDocuments({ kind: "payment" })).toBe(0);
  const q = paymentBody(c.id, { cashAccountId: account });
  const [a, b] = await Promise.all([
    sourcePost("/billing/payments", q),
    sourcePost("/billing/payments", q),
  ]);
  expect([a.status, b.status].sort()).toEqual([200, 201]);
  expect(await CashMovement.countDocuments({ kind: "payment" })).toBe(1);
  expect((await CashMovement.findOne({ kind: "payment" }))!.date).toBe(
    "2025-02-10",
  );
  expect(
    (
      await sourcePost(`/billing/payments/${a.body.payment.id}/reverse`, {
        confirmed: true,
        reason: "Qaytarish sinovi",
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await sourcePost(`/billing/payments/${a.body.payment.id}/reverse`, {
        confirmed: true,
        reason: "Qaytarish sinovi",
      })
    ).status,
  ).toBe(200);
  expect(await CashMovement.countDocuments({ kind: "payment_reversal" })).toBe(
    1,
  );
  const old = await sourcePost("/billing/payments", paymentBody(c.id));
  const before = (await Payment.findById(old.body.payment.id))!.toObject();
  expect((await balances()).unallocated.payment).toEqual({
    count: 1,
    amount: 300,
  });
  expect((await Payment.findById(old.body.payment.id))!.toObject()).toEqual(
    before,
  );
  expect(
    (
      await sourcePost(
        "/billing/payments",
        paymentBody(c.id, {
          cashAccountId: new mongoose.Types.ObjectId().toString(),
        }),
      )
    ).status,
  ).toBe(404);
  expect(await Payment.countDocuments()).toBe(2);
});
it("excludes salary drafts; represents actual payouts once and reverses the same account", async () => {
  const p = await Payroll.create({
    tenantId: tenant,
    teacherId: userId,
    payrollMonth: "2025-02",
    calculationBasis: { lines: [] },
    grossSalary: 1000,
    finalSalary: 1000,
    calculatedAt: new Date(),
    createdBy: userId,
  });
  expect(await CashMovement.countDocuments({ kind: "salary" })).toBe(0);
  const q = {
    amount: 400,
    paidAt: "2025-02-10T00:00:00+05:00",
    method: "cash",
    cashAccountId: account,
    idempotencyKey: randomUUID(),
    confirmed: true,
  };
  expect((await sourcePost(`/payroll/${p.id}/payouts`, q)).status).toBe(409);
  expect(
    (
      await sourcePost(`/payroll/${p.id}/approve`, {
        revision: 0,
        confirmed: true,
      })
    ).status,
  ).toBe(200);
  const a = await sourcePost(`/payroll/${p.id}/payouts`, q);
  expect(a.status, JSON.stringify(a.body)).toBe(201);
  expect((await sourcePost(`/payroll/${p.id}/payouts`, q)).status).toBe(200);
  expect(await Expense.countDocuments()).toBe(0);
  expect(await CashMovement.countDocuments({ kind: "salary" })).toBe(1);
  expect((await balances()).unallocated.salary.count).toBe(0);
  expect(
    (
      await sourcePost(`/payroll/${p.id}/payouts/${a.body.id}/reverse`, {
        confirmed: true,
        reason: "Qaytarish sinovi",
      })
    ).status,
  ).toBe(204);
  expect(await CashMovement.countDocuments({ kind: "salary_reversal" })).toBe(
    1,
  );
  expect(
    (await balances()).rows.find((r: { id: string }) => r.id === account)
      .confirmedBalance,
  ).toBe(1000);
});
it("uses date-only Tashkent boundaries and current-date reversals without rewriting past cash days", async () => {
  expect(cashDay(new Date("2025-02-09T18:59:59.999Z"))).toBe("2025-02-09");
  expect(cashDay(new Date("2025-02-09T19:00:00Z"))).toBe("2025-02-10");
  const e = await draft();
  await post(`/expenses/${e.id}/confirm`, confirm());
  await post(`/expenses/${e.id}/void`, confirm());
  const historical = (await balances("2025-02-10")).rows.find(
    (r: { id: string }) => r.id === account,
  );
  expect(historical).toMatchObject({
    opening: 1000,
    outflow: 400,
    closing: 600,
  });
  const incomplete = (await balances("2025-01-31")).rows[0];
  expect(incomplete.complete).toBe(false);
});
it("rejects audit/movement mutation through model APIs", async () => {
  await expect(
    CashAudit.updateOne({}, { $set: { reason: "tamper" } }),
  ).rejects.toThrow("Immutable");
  await expect(CashAudit.deleteMany({})).rejects.toThrow("Immutable");
  await expect(
    CashMovement.findOneAndUpdate({}, { $set: { delta: 99 } }),
  ).rejects.toThrow("Immutable");
  const m = await CashMovement.findOne();
  m!.delta = 99;
  await expect(m!.save()).rejects.toThrow("Immutable");
  await expect(
    CashMovement.bulkWrite([{ deleteMany: { filter: {} } }]),
  ).rejects.toThrow("Immutable");
});
it("allows reversal into deactivated accounts while rejecting new movements", async () => {
  const e = await draft();
  await post(`/expenses/${e.id}/confirm`, confirm());
  await patch(`/accounts/${account}`, {
    name: "Arxiv kassa",
    active: false,
    reason: "Hisob yopildi",
    idempotencyKey: randomUUID(),
  });
  expect((await move()).status).toBe(409);
  expect((await post(`/expenses/${e.id}/void`, confirm())).status).toBe(200);
});
it("requires MFA-complete and non-revoked sessions through existing authentication", async () => {
  const user = await User.findById(userId);
  await User.updateOne({ _id: userId }, { $set: { mfaEnabled: true } });
  expect((await get("/expenses", owner)).status).toBe(401);
  const fresh = await User.findById(userId).select(
    "+sessionVersion +mfaEnabled",
  );
  const cookie =
    "softlans_session=" +
    (await createSession(fresh!, config, undefined, true));
  expect((await get("/expenses", cookie)).status).toBe(200);
  await User.updateOne({ _id: user!._id }, { $inc: { sessionVersion: 1 } });
  expect((await get("/expenses", cookie)).status).toBe(401);
});
it("rejects immutable expense mutation and simultaneous confirmation with different keys", async () => {
  const e = await draft();
  const results = await Promise.all([
    post(`/expenses/${e.id}/confirm`, confirm()),
    post(`/expenses/${e.id}/confirm`, confirm()),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  const persisted = await Expense.findById(e.id);
  persisted!.amount = 500;
  await expect(persisted!.save()).rejects.toThrow("void and replacement");
  await expect(
    Expense.updateOne({ _id: e.id }, { $set: { amount: 500 } }),
  ).rejects.toThrow("void and replacement");
  await expect(Expense.findByIdAndDelete(e.id)).rejects.toThrow(
    "void and replacement",
  );
  expect((await Expense.findById(e.id))!.amount).toBe(400);
});
it("never allocates historical unallocated reversals or permits fabricated salary movement types", async () => {
  const c = await charge();
  const p = await sourcePost("/billing/payments", paymentBody(c.id));
  const before = await CashMovement.countDocuments();
  expect(
    (
      await sourcePost(`/billing/payments/${p.body.payment.id}/reverse`, {
        confirmed: true,
        reason: "Eski yozuvni qaytarish",
      })
    ).status,
  ).toBe(200);
  expect(await CashMovement.countDocuments()).toBe(before);
  expect((await balances()).unallocated.payment.count).toBe(0);
  expect((await move({ kind: "salary" })).status).toBe(400);
});
it("rolls back numeric overflow without leaving half a transfer or an audit entry", async () => {
  await CashMovement.create({
    tenantId: tenant,
    recordedBy: userId,
    accountId: bank,
    delta: Number.MAX_SAFE_INTEGER - 1000,
    date: "2025-02-10",
    kind: "manual_in",
    sourceId: randomUUID(),
    reason: "Sintetik chegara sinovi",
  });
  const movementCount = await CashMovement.countDocuments(),
    auditCount = await CashAudit.countDocuments();
  expect((await move()).status).toBe(409);
  expect(await CashMovement.countDocuments()).toBe(movementCount);
  expect(await CashAudit.countDocuments()).toBe(auditCount);
});
