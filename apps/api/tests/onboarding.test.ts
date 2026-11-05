import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import mongoose from "mongoose";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { createApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import { connectDatabase } from "../src/db.js";
import { ensureIndexes, Tenant, User, Student } from "../src/models.js";
import { Group } from "../src/group-models.js";
import { Subscription } from "../src/saas-models.js";
import { ensureSaasDefaults, createInitialTrial } from "../src/saas-service.js";
import { issueToken } from "../src/security.js";
const origin = "http://localhost:5173";
const config = parseConfig({
  NODE_ENV: "test",
  APP_ORIGIN: origin,
  MONGODB_URI: "mongodb://localhost/test",
  JWT_SECRET: "s".repeat(48),
});
let repl: MongoMemoryReplSet,
  app: ReturnType<typeof createApp>,
  tenant: mongoose.Types.ObjectId,
  uid: mongoose.Types.ObjectId;
let owner: string;
async function actor(role: string, tenantId: mongoose.Types.ObjectId | null) {
  const user = await User.create({
    role,
    tenantId,
    name: "Sinov",
    email: `${randomUUID()}@example.test`,
    passwordHash: "unused",
  });
  return { user, cookie: `softlans_session=${issueToken(user, config)}` };
}
const get = (cookie = owner) =>
  request(app).get("/api/onboarding").set("Cookie", cookie);
const patch = (body: object, cookie = owner, path = "progress") =>
  request(app)
    .patch(`/api/onboarding/${path}`)
    .set("Cookie", cookie)
    .set("Origin", origin)
    .send(body);
beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: "7.0.24" },
  });
  await connectDatabase(repl.getUri("onboarding_test"));
  await ensureIndexes();
  await ensureSaasDefaults();
});
beforeEach(async () => {
  for (const model of [User, Tenant, Subscription, Student, Group])
    await model.deleteMany({});
  tenant = (await Tenant.create({ name: "Markaz", onboarding: {} }))._id;
  const a = await actor("business_owner", tenant);
  uid = a.user._id;
  owner = a.cookie;
  app = createApp(config);
});
afterAll(async () => {
  await mongoose.disconnect();
  await repl?.stop();
});
it("initializes registration atomically and rolls back failed registration", async () => {
  const body = {
    centerName: "Yangi markaz",
    name: "Rahbar Sinov",
    email: "new@example.test",
    password: "strong-password-123",
  };
  const register = (b = body) =>
    request(app).post("/api/auth/register").set("Origin", origin).send(b);
  const result = await register();
  expect(result.status).toBe(201);
  const created = await Tenant.findById(result.body.tenant.id);
  expect(created?.onboarding?.status).toBe("not_started");
  expect((await register()).status).toBe(409);
  expect(await Tenant.countDocuments()).toBe(2);
  expect(
    (
      await register({
        ...body,
        email: "bad@example.test",
        ...{ planId: new mongoose.Types.ObjectId().toString() },
      })
    ).status,
  ).toBe(503);
  expect(await Tenant.countDocuments()).toBe(2);
});
it("does not enroll legacy tenants", async () => {
  await Tenant.updateOne({ _id: tenant }, { $unset: { onboarding: 1 } });
  expect((await get()).body.state).toBeNull();
  expect((await patch({ action: "save", revision: 0 })).status).toBe(404);
});
it("persists progress across a revoked logout session and a fresh session", async () => {
  expect(
    (await patch({ action: "save", revision: 0, currentStep: "students" }))
      .status,
  ).toBe(200);
  await request(app)
    .post("/api/auth/logout")
    .set("Cookie", owner)
    .set("Origin", origin)
    .send({});
  expect((await get()).status).toBe(401);
  const user = await User.findById(uid).select("+sessionVersion");
  owner = `softlans_session=${issueToken(user!, config)}`;
  expect((await get()).body.state).toMatchObject({
    currentStep: "students",
    status: "in_progress",
    revision: 1,
  });
});
it("uses owner RBAC and isolates tenant state", async () => {
  for (const role of ["admin", "teacher", "super_admin"]) {
    const a = await actor(role, role === "super_admin" ? null : tenant);
    expect((await get(a.cookie)).status).toBe(403);
    expect(
      (await patch({ action: "skip", revision: 0 }, a.cookie)).status,
    ).toBe(403);
  }
  const other = await Tenant.create({ name: "Other", onboarding: {} });
  const b = await actor("business_owner", other._id);
  expect(
    (await patch({ action: "save", revision: 0, tenantId: other._id })).status,
  ).toBe(400);
  await patch({ action: "skip", revision: 0 });
  expect((await get(b.cookie)).body.state.status).toBe("not_started");
});
it("rejects stale concurrent changes without duplicates, recovers and completes", async () => {
  const results = await Promise.all([
    patch({ action: "skip", revision: 0 }),
    patch({ action: "save", revision: 0 }),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  expect((await patch({ action: "complete", revision: 1 })).status).toBe(200);
  const completedAt = (await get()).body.state.completedAt;
  await patch({ action: "skip", revision: 2 });
  const state = (await get()).body.state;
  expect(state.status).toBe("completed");
  expect(state.completedAt).toBe(completedAt);
  await patch({ action: "dismiss", revision: 3 });
  expect((await get()).body.state.dismissedAt).toBeTruthy();
});
it("validates inputs, saves permitted center fields and returns real missing-resource facts", async () => {
  expect((await patch({ action: "save", revision: -1 })).status).toBe(400);
  expect(
    (await patch({ name: "X", phone: "wrong" }, owner, "center")).status,
  ).toBe(400);
  expect(
    (
      await patch(
        { name: "Kelajak", phone: "+998901234567", address: "Toshkent" },
        owner,
        "center",
      )
    ).status,
  ).toBe(200);
  const result = await get();
  expect(result.body.counts).toEqual({ teachers: 0, groups: 0, students: 0 });
  expect(result.body.facts).toEqual({
    center: true,
    teacher: false,
    group: false,
    students: false,
    telegram: false,
  });
  expect(JSON.stringify(result.body)).not.toMatch(
    /passwordHash|tokenHash|chatId/,
  );
  expect((await patch({ action: "save", revision: 0 })).status).toBe(409);
});
it("allows safe metadata after expiry but blocks center and CRM writes without extending trial", async () => {
  await mongoose.connection.transaction((s) =>
    createInitialTrial(tenant, uid, s),
  );
  await Subscription.updateOne(
    { tenantId: tenant },
    { $set: { trialEnd: new Date(0), periodEnd: new Date(0) } },
  );
  expect((await patch({ action: "save", revision: 0 })).status).toBe(200);
  expect((await patch({ name: "Yangi" }, owner, "center")).status).toBe(402);
  for (const path of ["team", "groups", "students"])
    expect(
      (
        await request(app)
          .post(`/api/${path}`)
          .set("Cookie", owner)
          .set("Origin", origin)
          .send({})
      ).status,
    ).toBe(402);
  expect(
    (await Subscription.findOne({ tenantId: tenant }))?.trialEnd?.getTime(),
  ).toBe(0);
});
it("reused creation APIs enforce student and group quotas", async () => {
  await mongoose.connection.transaction((s) =>
    createInitialTrial(tenant, uid, s),
  );
  await Subscription.updateOne(
    { tenantId: tenant },
    { $set: { studentLimit: 0, groupLimit: 0 } },
  );
  const teacher = await actor("teacher", tenant);
  const group = {
    name: "Birinchi",
    courseName: "English",
    teacherId: teacher.user._id.toString(),
    capacity: 20,
    monthlyFee: 100000,
    startDate: "2026-11-05",
  };
  expect(
    (
      await request(app)
        .post("/api/groups")
        .set("Cookie", owner)
        .set("Origin", origin)
        .send(group)
    ).status,
  ).toBe(409);
  const student = {
    firstName: "Ali",
    lastName: "Valiyev",
    enrollmentDate: "2026-11-05",
    status: "active",
  };
  expect(
    (
      await request(app)
        .post("/api/students")
        .set("Cookie", owner)
        .set("Origin", origin)
        .send(student)
    ).status,
  ).toBe(409);
});
