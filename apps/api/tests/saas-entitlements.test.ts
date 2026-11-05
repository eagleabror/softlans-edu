import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { createApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import { connectDatabase } from "../src/db.js";
import { ensureIndexes, Student, Tenant, User } from "../src/models.js";
import { Group } from "../src/group-models.js";
import { Lead } from "../src/lead-models.js";
import { Subscription, Plan } from "../src/saas-models.js";
import { issueToken } from "../src/security.js";
import { StudentImportLog, StudentImportSession } from "../src/import-models.js";

const origin = "http://localhost:5173";
const config = parseConfig({ NODE_ENV: "test", APP_ORIGIN: origin,
  MONGODB_URI: "mongodb://localhost/test", JWT_SECRET: "s".repeat(48) });
let repl: MongoMemoryReplSet, app: ReturnType<typeof createApp>;
let tenantId: mongoose.Types.ObjectId, ownerId: mongoose.Types.ObjectId, teacherId: mongoose.Types.ObjectId;
let owner: string, other: string;
const student = { firstName: "Sinov", lastName: "O‘quvchi" };
const post = (path: string, body: object, cookie = owner) => request(app).post(path)
  .set("Cookie", cookie).set("Origin", origin).send(body);
const patch = (path: string, body: object) => request(app).patch(path)
  .set("Cookie", owner).set("Origin", origin).send(body);
async function actor(tenant: mongoose.Types.ObjectId, role: "business_owner" | "teacher") {
  const user = await User.create({ tenantId: tenant, role, name: "Sinov",
    email: `${new mongoose.Types.ObjectId()}@example.test`, passwordHash: "unused" });
  return { id: user._id, cookie: `softlans_session=${issueToken(user, config)}` };
}
async function subscribe(overrides: object = {}) {
  const plan = await Plan.create({ name: "Sinov", code: `test-${new mongoose.Types.ObjectId()}`,
    monthlyPriceUZS: 149000, studentLimit: 1, groupLimit: 1 });
  return Subscription.create({ tenantId, planId: plan._id, planName: plan.name, planCode: plan.code, status: "active",
    periodStart: new Date(), periodEnd: new Date(Date.now() + 86400000),
    agreedPriceUZS: 149000, studentLimit: 1, groupLimit: 1, ...overrides });
}
const group = () => ({ name: "Sinov guruhi", courseName: "Matematika", teacherId: teacherId.toString(),
  capacity: 10, monthlyFee: 100000, startDate: "2026-01-01" });
beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: "7.0.24" } });
  await connectDatabase(repl.getUri("saas_limits"));
  await ensureIndexes();
});
beforeEach(async () => {
  await Promise.all([Student.deleteMany({}), Group.deleteMany({}), Lead.deleteMany({}),
    Subscription.deleteMany({}), Plan.deleteMany({}), User.deleteMany({}), Tenant.deleteMany({}),
    StudentImportLog.deleteMany({}), StudentImportSession.deleteMany({})]);
  tenantId = (await Tenant.create({ name: "Sinov A" }))._id;
  const actorOwner = await actor(tenantId, "business_owner");
  owner = actorOwner.cookie; ownerId = actorOwner.id;
  teacherId = (await actor(tenantId, "teacher")).id;
  other = (await actor((await Tenant.create({ name: "Sinov B" }))._id, "business_owner")).cookie;
  app = createApp(config);
});
afterAll(async () => { await mongoose.disconnect(); await repl?.stop(); });

it("serializes concurrent active student creates, counts only active and isolates tenants", async () => {
  await subscribe();
  const results = await Promise.all([post("/api/students", student), post("/api/students", student)]);
  expect(results.map(r => r.status).sort()).toEqual([201, 409]);
  expect(results.find(r => r.status === 409)?.body.error.code).toBe("PLAN_LIMIT_REACHED");
  expect(await Student.countDocuments({ tenantId, status: "active" })).toBe(1);
  expect((await post("/api/students", { ...student, status: "paused" })).status).toBe(201);
  expect((await post("/api/students", student, other)).status).toBe(201);
});

it("checks student unarchive and retains existing records when a limit falls", async () => {
  const subscription = await subscribe({ studentLimit: 2 });
  const first = await post("/api/students", student);
  const second = await post("/api/students", student);
  expect(second.status).toBe(201);
  await Subscription.updateOne({ _id: subscription._id }, { $set: { studentLimit: 1 } });
  expect((await post("/api/students", student)).status).toBe(409);
  expect(await Student.countDocuments({ tenantId })).toBe(2);
  await patch(`/api/students/${first.body.student.id}/status`, { status: "archived" });
  const reactivate = await patch(`/api/students/${first.body.student.id}/status`, { status: "active" });
  expect(reactivate.status).toBe(409);
  expect((await Student.findById(first.body.student.id))?.status).toBe("archived");
});

it("serializes concurrent group creation and checks reactivation", async () => {
  await subscribe();
  const results = await Promise.all([post("/api/groups", group()), post("/api/groups", group())]);
  expect(results.map(r => r.status).sort()).toEqual([201, 409]);
  const inactive = await post("/api/groups", { ...group(), status: "archived" });
  expect(inactive.status).toBe(201);
  expect((await patch(`/api/groups/${inactive.body.group.id}`, { status: "active" })).status).toBe(409);
  expect(await Group.countDocuments({ tenantId, status: "active" })).toBe(1);
});

it("enforces Excel import quota within the batch transaction with an actionable error", async () => {
  await subscribe();
  const preview = await post("/api/student-imports/preview", { filename: "test.csv",
    data: Buffer.from("Ism,Familiya\nAli,Valiyev\nVali,Aliyev").toString("base64") });
  expect(preview.status).toBe(200);
  const result = await post(`/api/student-imports/${preview.body.id}/commit`, {
    idempotencyKey: crypto.randomUUID(), revision: preview.body.revision, duplicates: "skip" });
  expect(result.status).toBe(200);
  expect(result.body.import.status).toBe("failed");
  expect(result.body.import.errorSummary).toContain("limiti");
  // A failed batch rolls back completely; no silent partial row inside a batch.
  expect(await Student.countDocuments({ tenantId })).toBe(0);
});

it("blocks lead conversion atomically at the student limit while allowing an existing student link", async () => {
  await subscribe();
  const existing = await post("/api/students", student);
  const lead = await Lead.create({ tenantId, fullName: "Sinov Mijoz", phone: "+998901234567",
    interestedCourse: "Matematika", source: "telegram", status: "contacted", createdBy: ownerId });
  const conversion = await post(`/api/leads/${lead.id}/convert`, { confirmed: true, student });
  expect(conversion.status).toBe(409);
  expect((await Lead.findById(lead.id))?.status).toBe("contacted");
  const linked = await post(`/api/leads/${lead.id}/convert`, { confirmed: true, existingStudentId: existing.body.student.id });
  expect(linked.status).toBe(200);
  expect(await Student.countDocuments({ tenantId })).toBe(1);
});

it.each(["expired", "suspended", "cancelled", "past_due"])("keeps %s tenants read-only without deleting their data", async (status) => {
  await Student.create({ tenantId, ...student, createdBy: ownerId });
  await subscribe({ status });
  expect((await post("/api/students", student)).status).toBe(402);
  expect((await post("/api/leads", { fullName: "Sinov", phone: "+998901234567", source: "telegram", interestedCourse: "Kurs" })).status).toBe(402);
  expect((await post("/api/team", { name: "Sinov", email: "extra@example.test", password: "Test1234567!", role: "admin" })).status).toBe(402);
  const list = await request(app).get("/api/students").set("Cookie", owner);
  expect(list.status).toBe(200); expect(list.body.total).toBe(1);
  expect((await post("/api/auth/logout", {})).status).toBe(204);
});

it("expires active periods and trials using server time even before the scheduler runs", async () => {
  const subscription = await subscribe({ periodEnd: new Date(Date.now() - 1) });
  expect((await post("/api/groups", group())).status).toBe(402);
  await Subscription.updateOne({ _id: subscription._id }, { $set: {
    status: "trialing", trialStart: new Date(Date.now() - 14 * 86400000), trialEnd: new Date(Date.now() - 1),
    periodEnd: new Date(Date.now() + 86400000) } });
  expect((await post("/api/students", student)).status).toBe(402);
});

it("preserves legacy tenant access without granting a trial", async () => {
  expect((await post("/api/students", student)).status).toBe(201);
  expect((await post("/api/groups", group())).status).toBe(201);
  expect(await Subscription.countDocuments({ tenantId })).toBe(0);
});
