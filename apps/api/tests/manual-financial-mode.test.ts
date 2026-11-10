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
import { Charge } from "../src/billing-models.js";
import { Payroll, SalaryPayout, PayrollAudit } from "../src/payroll-models.js";
import { createSession } from "../src/security.js";
import { DeviceSession } from "../src/security-models.js";

// No process.env URI or scheduler credentials: only a new disposable loopback DB.
const origin = "http://localhost:5173";
const config = parseConfig({ NODE_ENV: "test", APP_ORIGIN: origin,
  JWT_SECRET: randomBytes(48).toString("hex"), MONGODB_URI: "mongodb://localhost/unused" });
const app = createApp(config);
let repl: MongoMemoryReplSet;
const outbound = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Synthetic only: outbound blocked"));
const post = (path: string, body: object, cookie: string) => request(app).post("/api" + path).set("Cookie", cookie).set("Origin", origin).send(body);
const get = (path: string, cookie: string) => request(app).get("/api" + path).set("Cookie", cookie);
function ok(r: { status: number; body: unknown }, status = 200) { expect(r.status, JSON.stringify(r.body)).toBe(status); }
beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: "7.0.24" } });
  const uri = repl.getUri("manual-financial-disposable-only");
  expect(uri).toMatch(/^mongodb:\/\/127\.0\.0\.1:/);
  await connectDatabase(uri);
  await ensureIndexes();
});
afterAll(async () => {
  vi.useRealTimers();
  await mongoose.disconnect();
  await repl?.stop();
  expect(outbound).not.toHaveBeenCalled();
  outbound.mockRestore();
});
it("completes manual enrollment, billing, debt and owner payroll with all scheduler secrets absent", async () => {
  expect([config.BILLING_SCHEDULER_SECRET, config.PAYROLL_SCHEDULER_SECRET, config.NOTIFICATION_SCHEDULER_SECRET]).toEqual([undefined, undefined, undefined]);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-16T09:00:00+05:00"));
  const tenant = await Tenant.create({ name: "Sintetik qo‘lda markaz" });
  const foreignTenant = await Tenant.create({ name: "Sintetik boshqa markaz" });
  async function actor(role: "business_owner" | "admin" | "teacher", tenantId = tenant._id) {
    const user = await User.create({ tenantId, role, name: "Sintetik " + role, email: randomUUID() + "@example.test", passwordHash: "unused" });
    return { user, cookie: "softlans_session=" + await createSession(user, config) };
  }
  const owner = await actor("business_owner"), admin = await actor("admin"), teacher = await actor("teacher");
  const collected = await actor("teacher"), fixed = await actor("teacher"), missingRule = await actor("teacher");
  const foreign = await actor("business_owner", foreignTenant._id);
  const group = await Group.create({ tenantId: tenant._id, teacherId: teacher.user._id, name: "Sintetik guruh", courseName: "Matematika", capacity: 10, monthlyFee: 300000, startDate: "2026-10-01" });
  await Schedule.create([1, 3, 5].map(dayOfWeek => ({ tenantId: tenant._id, groupId: group._id, teacherId: teacher.user._id, classroomId: new mongoose.Types.ObjectId(), dayOfWeek, startTime: "10:00", endTime: "11:00" })));
  const student = await post("/students", { firstName: "Sintetik", lastName: "Oquvchi", enrollmentDate: "2026-10-16" }, admin.cookie);
  ok(student, 201);
  const preview = await get(`/groups/${group.id}/billing-preview?studentId=${student.body.student.id}`, admin.cookie);
  ok(preview);
  ok(await post(`/groups/${group.id}/members`, { studentId: student.body.student.id, billingPreviewKey: preview.body.previewKey }, admin.cookie), 201);
  const first = (await Charge.findOne({ tenantId: tenant._id }))!;
  expect(first.toObject()).toMatchObject({ finalAmount: 161538, prorationAmount: 138462, generationSource: "enrollment", calculation: { totalLessons: 13, eligibleLessons: 7 } });
  const generate = (month: string, cookie = admin.cookie) => post("/billing/charges/generate", { month, confirmed: true }, cookie);
  const payroll = (cookie = owner.cookie, month = "2026-10") => post("/payroll/automation/run", { month, confirmed: true }, cookie);
  ok(await post("/billing/charges/generate", { month: "2026-11" }, admin.cookie), 400);
  ok(await generate("2026-11", teacher.cookie), 403);
  const generated = await generate("2026-11");
  ok(generated);
  expect(generated.body).toMatchObject({ created: 1, skipped: 0 });
  expect((await generate("2026-11", owner.cookie)).body).toMatchObject({ created: 0, skipped: 1 });
  expect(await Charge.countDocuments({ tenantId: tenant._id })).toBe(2);
  expect((await Charge.findById(first.id))!.toObject()).toEqual(first.toObject());
  const next = (await Charge.findOne({ billingMonth: "2026-11" }))!;
  expect(next.finalAmount).toBe(300000);
  ok(await post("/billing/payments", { chargeId: first.id, amount: 100000, method: "cash", paidAt: "2026-10-16T09:00:00+05:00", idempotencyKey: randomUUID(), confirmed: true }, admin.cookie), 201);
  expect((await get("/debts/summary", owner.cookie)).body.outstandingAmount).toBe(361538);
  const before = (await Charge.findById(first.id))!.toObject();
  expect((await generate("2026-10")).body).toMatchObject({ created: 0, skipped: 1 });
  expect((await Charge.findById(first.id))!.toObject()).toEqual(before);
  expect((await get("/billing/charges?month=2026-10&status=partial", admin.cookie)).body.total).toBe(1);
  expect((await get("/billing/charges?month=2026-11&status=unpaid", admin.cookie)).body.total).toBe(1);
  ok(await get(`/billing/charges/${first.id}`, foreign.cookie), 404);
  expect((await generate("2026-11", foreign.cookie)).body.created).toBe(0);
  expect((await get("/billing/payments", admin.cookie)).body.total).toBe(1);
  for (const [target, salaryType, values] of [[teacher, "billed", { percentage: 40 }], [collected, "collected", { percentage: 50 }], [fixed, "fixed", { fixedAmount: 500000 }]] as const) {
    ok(await post("/payroll/rules", { teacherId: target.user.id, salaryType, ...values, effectiveFrom: "2026-10-01", reason: "Sintetik kelishuv" }, owner.cookie), 201);
  }
  // Zero collections are valid with an actual calculation group; an unassigned
  // percentage rule is now an explicit Phase C group exception.
  await Group.create({ tenantId: tenant._id, teacherId: collected.user._id,
    name: "Sintetik tushumsiz guruh", courseName: "Matematika", capacity: 10,
    monthlyFee: 300000, startDate: "2026-10-01" });
  ok(await payroll(owner.cookie, "2026-10"), 409); // Still open at October 16.
  vi.setSystemTime(new Date("2026-11-02T12:00:00+05:00"));
  for (const a of [owner, admin, teacher, foreign]) a.cookie = "softlans_session=" + await createSession(a.user, config);
  ok(await payroll(admin.cookie), 403);
  ok(await payroll(teacher.cookie), 403);
  ok(await get("/payroll/automation/status?month=2026-10", admin.cookie), 403);
  ok(await post("/payroll/automation/run", { month: "2026-10" }, owner.cookie), 400);
  ok(await request(app).post("/api/payroll/automation/run").set("Cookie", owner.cookie).send({ month: "2026-10", confirmed: true }), 403);
  const batch = await payroll();
  ok(batch);
  expect(batch.body).toMatchObject({ created: 3, preserved: 0, exceptions: 1, status: "exceptions", nextTeacher: null });
  const p = (await Payroll.findOne({ teacherId: teacher.user._id }))!;
  expect(p.toObject()).toMatchObject({ status: "draft", grossSalary: 64615, paidAmount: 0, generationSource: "manual" });
  expect((await Payroll.findOne({ teacherId: fixed.user._id }))!.finalSalary).toBe(500000);
  expect((await Payroll.findOne({ teacherId: collected.user._id }))!.finalSalary).toBe(0);
  expect(await SalaryPayout.countDocuments()).toBe(0);
  const status = await get("/payroll/automation/status?month=2026-10", owner.cookie);
  ok(status);
  expect(status.body.items).toContainEqual(expect.objectContaining({ teacherId: String(missingRule.user._id), code: "NO_SALARY_RULE" }));
  expect((await payroll()).body).toMatchObject({ created: 0, preserved: 3, exceptions: 1 });
  expect(await Payroll.countDocuments()).toBe(3);
  ok(await get(`/payroll/${p.id}`, foreign.cookie), 404);
  expect((await get("/payroll/automation/status?month=2026-10", foreign.cookie)).body.items).toEqual([]);
  const payout = { amount: 30000, method: "cash", paidAt: "2026-11-02T12:00:00+05:00", idempotencyKey: randomUUID(), confirmed: true };
  ok(await post(`/payroll/${p.id}/payouts`, payout, owner.cookie), 409);
  ok(await post(`/payroll/${p.id}/adjustments`, { revision: 0, amount: -1000, reason: "Sintetik tuzatish" }, owner.cookie));
  ok(await post(`/payroll/${p.id}/approve`, { revision: 1, confirmed: true }, owner.cookie));
  expect(await SalaryPayout.countDocuments()).toBe(0);
  ok(await post(`/payroll/${p.id}/payouts`, payout, owner.cookie), 201);
  const immutable = (await Payroll.findById(p.id))!.toObject();
  await payroll();
  expect((await Payroll.findById(p.id))!.toObject()).toEqual(immutable);
  expect(await PayrollAudit.countDocuments({ entityId: p._id, action: "draft_created" })).toBe(1);
  ok(await post("/billing/payments", { chargeId: first.id, amount: 61538, method: "cash", paidAt: payout.paidAt, idempotencyKey: randomUUID(), confirmed: true }, admin.cookie), 201);
  expect((await get("/billing/charges?month=2026-10&status=paid", admin.cookie)).body.total).toBe(1);
  const paid = (await Charge.findById(first.id))!.toObject();
  await generate("2026-10");
  expect((await Charge.findById(first.id))!.toObject()).toEqual(paid);
  expect((await get("/debts/summary", owner.cookie)).body.outstandingAmount).toBe(300000);
  const cancel = (cookie: string) => request(app).patch(`/api/billing/charges/${next.id}`)
    .set("Cookie", cookie).set("Origin", origin)
    .send({ originalAmount: 300000, discountAmount: 0, cancelled: true, reason: "Sintetik bekor qilish" });
  ok(await cancel(admin.cookie), 403);
  ok(await cancel(owner.cookie));
  const cancelled = (await Charge.findById(next.id))!.toObject();
  expect((await generate("2026-11")).body).toMatchObject({ created: 0, skipped: 1 });
  expect((await Charge.findById(next.id))!.toObject()).toEqual(cancelled);
  expect((await get("/debts/summary", owner.cookie)).body.outstandingAmount).toBe(0);
  for (const path of ["billing", "payroll", "notifications"]) {
    for (const auth of [undefined, "Bearer " + randomBytes(48).toString("hex")]) {
      const r = request(app).post(`/api/internal/${path}/run`).set("Cookie", owner.cookie);
      if (auth) r.set("Authorization", auth);
      const response = await r.send({});
      ok(response, 503);
      expect(response.body.error.code).toBe("SCHEDULER_DISABLED");
    }
  }
  await User.updateOne({ _id: owner.user._id }, { $set: { mfaEnabled: true } });
  ok(await payroll(), 401);
  ok(await generate("2026-11", owner.cookie), 401);
  owner.cookie = "softlans_session=" + await createSession(owner.user, config, undefined, true);
  ok(await get("/payroll/automation/status?month=2026-10", owner.cookie));
  await DeviceSession.updateMany({ userId: owner.user._id }, { $set: { revokedAt: new Date() } });
  ok(await payroll(), 401);
  ok(await generate("2026-11", owner.cookie), 401);
}, 60000);
