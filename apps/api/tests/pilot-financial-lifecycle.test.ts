import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { createApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import { connectDatabase } from "../src/db.js";
import { ensureIndexes, Tenant, User } from "../src/models.js";
import { Group } from "../src/group-models.js";
import { Schedule } from "../src/schedule-models.js";
import { Charge, Payment } from "../src/billing-models.js";
import { Payroll } from "../src/payroll-models.js";
import { CashMovement, Expense } from "../src/cash-models.js";
import { createSession } from "../src/security.js";

// Never consumes MONGODB_URI or any external credentials. Only a newly created
// loopback replica set is connected. Outbound messages fail closed.
const origin = "http://localhost:5173";
const config = parseConfig({
  NODE_ENV: "test", APP_ORIGIN: origin,
  JWT_SECRET: randomBytes(48).toString("hex"),
  MONGODB_URI: "mongodb://localhost/unused-pilot-fixture",
  PAYROLL_SCHEDULER_SECRET: randomBytes(48).toString("hex"),
});
const app = createApp(config);
let repl: MongoMemoryReplSet;
const outbound = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Synthetic audit: outbound disabled"));
const confirm = (extra = {}) => ({ confirmed: true, idempotencyKey: randomUUID(), reason: "Sintetik audit", ...extra });
const post = (path: string, body: object, cookie: string) => request(app).post("/api" + path).set("Cookie", cookie).set("Origin", origin).send(body);
const get = (path: string, cookie: string) => request(app).get("/api" + path).set("Cookie", cookie);
const patch = (path: string, body: object, cookie: string) => request(app).patch("/api" + path).set("Cookie", cookie).set("Origin", origin).send(body);
function ok(r: { status: number; body: unknown }, status: number) {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
}
beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: "7.0.24" } });
  await connectDatabase(repl.getUri("pilot-financial-disposable-only"));
  await ensureIndexes();
});
afterAll(async () => {
  vi.useRealTimers();
  await mongoose.disconnect();
  await repl?.stop();
  expect(outbound).not.toHaveBeenCalled();
  outbound.mockRestore();
});

it("reconciles enrollment through P&L and correction-period cash in three isolated pilot centers", async () => {
  const centers = [];
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-16T09:00:00+05:00"));
  for (let index = 0; index < 3; index++) {
    const tenant = await Tenant.create({ name: `Sintetik pilot ${index + 1}` });
    const owner = await User.create({ tenantId: tenant._id, role: "business_owner", name: "Sintetik egasi", email: randomUUID() + "@example.test", passwordHash: "unused" });
    const teacher = await User.create({ tenantId: tenant._id, role: "teacher", name: "Sintetik ustoz", email: randomUUID() + "@example.test", passwordHash: "unused" });
    const cookie = "softlans_session=" + await createSession(owner, config);
    const group = await Group.create({ tenantId: tenant._id, teacherId: teacher._id, name: "Sintetik fan", courseName: "Matematika", capacity: 10, monthlyFee: 300000, startDate: "2026-10-01" });
    await Schedule.create([1, 3, 5].map(dayOfWeek => ({ tenantId: tenant._id, groupId: group._id, teacherId: teacher._id, classroomId: new mongoose.Types.ObjectId(), dayOfWeek, startTime: "10:00", endTime: "11:00" })));
    const studentResponse = await post("/students", { firstName: "Sintetik", lastName: "Oquvchi", enrollmentDate: "2026-10-16" }, cookie);
    ok(studentResponse, 201);
    const studentId = studentResponse.body.student.id;
    const preview = await get(`/groups/${group.id}/billing-preview?studentId=${studentId}`, cookie);
    ok(preview, 200);
    ok(await post(`/groups/${group.id}/members`, { studentId, billingPreviewKey: preview.body.previewKey }, cookie), 201);
    const c = (await Charge.findOne({ tenantId: tenant._id }))!;
    expect(c.toObject()).toMatchObject({ originalAmount: 300000, prorationAmount: 138462, finalAmount: 161538, generationSource: "enrollment", calculation: { totalLessons: 13, eligibleLessons: 7 } });
    ok(await post("/cash/setup", confirm(), cookie), 200);
    const accounts = (await get("/cash/accounts", cookie)).body.rows;
    const cash = accounts.find((a: { kind: string }) => a.kind === "cash").id;
    const bank = accounts.find((a: { kind: string }) => a.kind === "bank").id;
    for (const [id, amount] of [[cash, 1000000], [bank, 0]])
      ok(await post(`/cash/accounts/${id}/opening`, confirm({ amount, date: "2026-10-01" }), cookie), 200);
    const payment = { chargeId: c.id, amount: 100000, method: "cash", paidAt: "2026-10-16T09:00:00+05:00", cashAccountId: cash, idempotencyKey: randomUUID(), confirmed: true };
    const responses = await Promise.all([post("/billing/payments", payment, cookie), post("/billing/payments", payment, cookie)]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 201]);
    expect((await get("/debts/summary", cookie)).body.outstandingAmount).toBe(61538);
    expect(await CashMovement.countDocuments({ tenantId: tenant._id, kind: "payment" })).toBe(1);
    ok(await post("/payroll/rules", { teacherId: teacher.id, salaryType: "billed", percentage: 40, effectiveFrom: "2026-10-01", reason: "Sintetik audit" }, cookie), 201);
    centers.push({ tenant, owner, teacher, cookie, cash, bank, chargeId: c.id, paymentId: responses[0]!.body.payment.id });
  }
  vi.useRealTimers();
  for (const center of centers) center.cookie = "softlans_session=" + await createSession(center.owner, config);
  // Exercise the real authenticated scheduler router, including every tenant cursor.
  let cursor: unknown;
  do {
    const r = await request(app).post("/api/internal/payroll/run").set("Authorization", `Bearer ${config.PAYROLL_SCHEDULER_SECRET}`).send({ month: "2026-10", ...(cursor ? { cursor } : {}) });
    ok(r, 200);
    expect(r.body.exceptions).toBe(0);
    cursor = r.body.nextCursor;
  } while (cursor);
  expect(await Payroll.countDocuments()).toBe(3);
  for (const center of centers) {
    const { tenant, cookie, cash, bank, chargeId, paymentId } = center;
    const p = (await Payroll.findOne({ tenantId: tenant._id }))!;
    expect(p.toObject()).toMatchObject({ status: "draft", grossSalary: 64615, finalSalary: 64615, generationSource: "scheduled" });
    expect(await CashMovement.countDocuments({ tenantId: tenant._id, kind: "salary" })).toBe(0);
    const payout = { amount: 30000, cashAccountId: cash, paidAt: "2026-11-02T12:00:00+05:00", method: "cash", idempotencyKey: randomUUID(), confirmed: true };
    ok(await post(`/payroll/${p.id}/payouts`, payout, cookie), 409);
    ok(await post(`/payroll/${p.id}/approve`, { confirmed: true, revision: p.revision }, cookie), 200);
    const paid = await post(`/payroll/${p.id}/payouts`, payout, cookie);
    ok(paid, 201);
    ok(await post(`/payroll/${p.id}/payouts`, payout, cookie), 200);
    ok(await post("/billing/payments", { chargeId, amount: 61538, method: "cash", paidAt: "2026-11-02T12:00:00+05:00", cashAccountId: cash, confirmed: true, idempotencyKey: randomUUID() }, cookie), 201);
    expect((await get("/debts/summary", cookie)).body.outstandingAmount).toBe(0);
    const categoryRow = (await get("/cash/categories", cookie)).body.rows[0];
    const category = categoryRow.id;
    ok(await patch(`/cash/categories/${category}`, { name: categoryRow.name, active: true, accountingClassification: "operating", reason: "Sintetik ijara", idempotencyKey: randomUUID() }, cookie), 200);
    const draft = await post("/cash/expenses", { amount: 20000, categoryId: category, accountId: cash, description: "Sintetik ijara", expenseDate: "2026-10-20", method: "cash", idempotencyKey: randomUUID() }, cookie);
    ok(draft, 201);
    ok(await post(`/cash/expenses/${draft.body.expense.id}/confirm`, confirm(), cookie), 200);
    const transfer = confirm({ kind: "transfer", accountId: cash, toAccountId: bank, amount: 50000, date: "2026-11-02" });
    ok(await post("/cash/movements", transfer, cookie), 201);
    ok(await post("/cash/movements", transfer, cookie), 201);
    const october = await get("/management-reports?start=2026-10-01&end=2026-10-31", cookie);
    ok(october, 200);
    expect(october.body.summary).toMatchObject({ billed: 161538, receipts: 100000, debt: 61538, approvedSalary: 64615, salaryPaid: 0, operatingExpenses: 20000, estimatedResult: 76923 });
    expect(october.body.cash.closing).toBe(1080000);
    const refund = { confirmed: true, reason: "Sintetik qaytarish" };
    for (let retry = 0; retry < 2; retry++) {
      ok(await post(`/billing/payments/${paymentId}/reverse`, refund, cookie), 200);
      ok(await post(`/payroll/${p.id}/payouts/${paid.body.id}/reverse`, refund, cookie), 204);
    }
    const voidExpense = confirm();
    for (let retry = 0; retry < 2; retry++)
      ok(await post(`/cash/expenses/${draft.body.expense.id}/void`, voidExpense, cookie), 200);
    expect((await get("/debts/summary", cookie)).body.outstandingAmount).toBe(100000);
    const final = await get("/management-reports?start=2026-10-01&end=2026-11-07", cookie);
    ok(final, 200);
    expect(final.body.summary).toMatchObject({ receipts: 61538, salaryPaid: 0, operatingExpenses: 0, estimatedResult: null });
    expect(final.body.cash).toMatchObject({ tuition: 61538, salary: 0, expenses: 0, transfers: 0, closing: 1061538 });
    expect(final.body.warnings).toContainEqual(expect.objectContaining({ code: "PARTIAL_MONTH" }));
    expect(await Payment.countDocuments({ tenantId: tenant._id })).toBe(2);
    expect(await Expense.countDocuments({ tenantId: tenant._id, status: "voided" })).toBe(1);
    const foreign = centers.find(c => !c.tenant._id.equals(tenant._id))!;
    ok(await get(`/cash/expenses/${draft.body.expense.id}`, foreign.cookie), 404);
    // Supported legacy/unallocated path must never fabricate a cash allocation.
    ok(await post("/billing/payments", { chargeId, amount: 1000, method: "cash", paidAt: "2026-11-03T12:00:00+05:00", confirmed: true, idempotencyKey: randomUUID() }, cookie), 201);
    const incomplete = await get("/management-reports?start=2026-10-01&end=2026-11-07", cookie);
    expect(incomplete.body.unallocated.payments).toEqual({ count: 1, amount: 1000 });
    expect(incomplete.body.cash.closing).toBe(1061538);
    expect(incomplete.body.summary.debt).toBe(99000);
    expect(incomplete.body.warnings).toContainEqual(expect.objectContaining({ code: "UNALLOCATED_HISTORY" }));
  }
}, 60000);
