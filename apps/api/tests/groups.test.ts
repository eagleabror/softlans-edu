import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { createApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import { connectDatabase } from "../src/db.js";
import { ensureIndexes, Student, Tenant, User } from "../src/models.js";
import { Group, Membership } from "../src/group-models.js";
import { issueToken } from "../src/security.js";
const origin = "http://localhost:5173";
const config = parseConfig({
  NODE_ENV: "test",
  APP_ORIGIN: origin,
  JWT_SECRET: randomBytes(48).toString("hex"),
  MONGODB_URI: "mongodb://localhost/test",
});
const app = createApp(config);
let repl: MongoMemoryReplSet;
let tenant: mongoose.Types.ObjectId, otherTenant: mongoose.Types.ObjectId;
let owner: string,
  admin: string,
  teacher: string,
  unassigned: string,
  other: string,
  platform: string,
  teacherId: string,
  otherTeacherId: string,
  studentId: string;
async function actor(
  role: "business_owner" | "admin" | "teacher" | "super_admin",
  tenantId: mongoose.Types.ObjectId | null,
) {
  const u = await User.create({
    role,
    tenantId,
    name: "Test",
    email: `${new mongoose.Types.ObjectId()}@example.test`,
    passwordHash: "unused",
  });
  return { id: u.id, cookie: `softlans_session=${issueToken(u, config)}` };
}
function get(path: string, c = owner) {
  return request(app)
    .get("/api" + path)
    .set("Cookie", c);
}
function post(path: string, body: object = {}, c = owner) {
  return request(app)
    .post("/api" + path)
    .set("Cookie", c)
    .set("Origin", origin)
    .send(body);
}
function patch(path: string, body: object, c = owner) {
  return request(app)
    .patch("/api" + path)
    .set("Cookie", c)
    .set("Origin", origin)
    .send(body);
}
const input = () => ({
  name: "Guruh A",
  courseName: "Ingliz tili",
  teacherId,
  capacity: 2,
  monthlyFee: 250000,
  startDate: "2026-11-01",
});
async function group(capacity = 2) {
  const r = await post("/groups", { ...input(), capacity });
  expect(r.status).toBe(201);
  return r.body.group.id as string;
}
async function student() {
  return (
    await Student.create({
      tenantId: tenant,
      firstName: "Sinov",
      lastName: "Oquvchi",
      createdBy: (await User.findOne({
        role: "business_owner",
        tenantId: tenant,
      }))!._id,
    })
  ).id as string;
}
beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: "7.0.24" },
  });
  await connectDatabase(repl.getUri("groups"));
  await ensureIndexes();
});
afterAll(async () => {
  await mongoose.disconnect();
  await repl?.stop();
});
beforeEach(async () => {
  await Promise.all([
    Membership.deleteMany({}),
    Group.deleteMany({}),
    Student.deleteMany({}),
    User.deleteMany({}),
    Tenant.deleteMany({}),
  ]);
  tenant = (await Tenant.create({ name: "A" }))._id;
  otherTenant = (await Tenant.create({ name: "B" }))._id;
  owner = (await actor("business_owner", tenant)).cookie;
  admin = (await actor("admin", tenant)).cookie;
  const t = await actor("teacher", tenant);
  teacher = t.cookie;
  teacherId = t.id;
  unassigned = (await actor("teacher", tenant)).cookie;
  other = (await actor("business_owner", otherTenant)).cookie;
  otherTeacherId = (await actor("teacher", otherTenant)).id;
  platform = (await actor("super_admin", null)).cookie;
  studentId = await student();
});
describe("Phase 2.2 groups", () => {
  it("creates, searches, updates, changes teacher and archives without deletion", async () => {
    const id = await group();
    expect((await get("/groups?search=Ingliz")).body.total).toBe(1);
    expect(
      (await patch(`/groups/${id}`, { name: "Yangi", monthlyFee: 0 }, admin))
        .status,
    ).toBe(200);
    const t = await actor("teacher", tenant);
    expect(
      (await patch(`/groups/${id}/teacher`, { teacherId: t.id }, admin)).status,
    ).toBe(200);
    expect((await get(`/groups/${id}`, teacher)).status).toBe(404);
    expect((await get(`/groups/${id}`, t.cookie)).status).toBe(200);
    expect(
      (await post(`/groups/${id}/archive`, {}, admin)).body.group.status,
    ).toBe("archived");
    expect((await post(`/groups/${id}/members`, { studentId })).status).toBe(
      409,
    );
    expect(await Group.countDocuments()).toBe(1);
  });
  it("preserves removal and re-enrollment history and allows multiple groups", async () => {
    const id = await group(),
      second = await group();
    expect(
      (await post(`/groups/${id}/members`, { studentId }, admin)).status,
    ).toBe(201);
    expect((await post(`/groups/${id}/members`, { studentId })).status).toBe(
      409,
    );
    expect(
      (await post(`/groups/${second}/members`, { studentId })).status,
    ).toBe(201);
    expect(
      (await post(`/groups/${id}/members/${studentId}/remove`)).status,
    ).toBe(204);
    expect((await post(`/groups/${id}/members`, { studentId })).status).toBe(
      201,
    );
    expect((await get(`/groups/${id}/members?status=removed`)).body.total).toBe(
      1,
    );
    expect(await Membership.countDocuments({ groupId: id })).toBe(2);
    expect(await Student.countDocuments()).toBe(1);
  });
  it("serializes simultaneous enrollment at capacity and duplicate enrollment", async () => {
    const id = await group(1);
    const ids = [studentId, await student(), await student()];
    const responses = await Promise.all(
      ids.map((studentId) => post(`/groups/${id}/members`, { studentId })),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect((await Group.findById(id))!.activeMemberCount).toBe(1);
    expect(
      await Membership.countDocuments({ groupId: id, status: "active" }),
    ).toBe(1);
    const second = await group(5);
    const duplicates = await Promise.all(
      [1, 2, 3].map(() => post(`/groups/${second}/members`, { studentId })),
    );
    expect(duplicates.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect((await Group.findById(second))!.activeMemberCount).toBe(1);
  });
  it("rejects lowering capacity below membership count and unsafe inputs", async () => {
    const id = await group();
    await post(`/groups/${id}/members`, { studentId });
    await post(`/groups/${id}/members`, { studentId: await student() });
    expect((await patch(`/groups/${id}`, { capacity: 1 })).status).toBe(409);
    for (const body of [
      { monthlyFee: -1 },
      { monthlyFee: 1.1 },
      { capacity: 0 },
      { capacity: 1.2 },
      { startDate: "2026-02-30" },
      { tenantId: otherTenant.toString() },
      { teacherId: "bad" },
      { extra: true },
    ])
      expect((await post("/groups", { ...input(), ...body })).status).toBe(400);
    expect((await patch(`/groups/${id}`, {})).status).toBe(400);
    expect((await get("/groups/bad")).status).toBe(404);
    expect((await get("/groups?page=0")).status).toBe(400);
  });
  it("rejects foreign, archived and missing references", async () => {
    expect(
      (await post("/groups", { ...input(), teacherId: otherTeacherId })).status,
    ).toBe(404);
    const notTeacher = (await actor("admin", tenant)).id;
    expect(
      (await post("/groups", { ...input(), teacherId: notTeacher })).status,
    ).toBe(404);
    const id = await group();
    expect(
      (await patch(`/groups/${id}/teacher`, { teacherId: otherTeacherId }))
        .status,
    ).toBe(404);
    const s = await Student.findById(studentId);
    s!.tenantId = tenant;
    await Student.updateOne(
      { _id: studentId },
      { $set: { status: "archived" } },
    );
    expect((await post(`/groups/${id}/members`, { studentId })).status).toBe(
      404,
    );
    const foreign = await Student.create({
      tenantId: otherTenant,
      firstName: "Other",
      lastName: "Student",
      createdBy: new mongoose.Types.ObjectId(),
    });
    expect(
      (await post(`/groups/${id}/members`, { studentId: foreign.id })).status,
    ).toBe(404);
    expect(
      (
        await post(`/groups/${id}/members`, {
          studentId: new mongoose.Types.ObjectId().toString(),
        })
      ).status,
    ).toBe(404);
  });
  it("enforces tenant boundaries, teacher projection, RBAC and authentication", async () => {
    const id = await group();
    await post(`/groups/${id}/members`, { studentId });
    await Student.updateOne(
      { _id: studentId },
      {
        $set: {
          phone: "+998901234567",
          notes: "private",
          parentName: "Parent",
        },
      },
    );
    for (const c of [other, unassigned]) {
      expect((await get("/groups", c)).body.total).toBe(0);
      expect((await get(`/groups/${id}`, c)).status).toBe(404);
      expect((await get(`/groups/${id}/members`, c)).status).toBe(404);
    }
    expect(
      (await patch(`/groups/${id}`, { name: "Attack" }, other)).status,
    ).toBe(404);
    expect(
      (await post(`/groups/${id}/members`, { studentId }, other)).status,
    ).toBe(404);
    expect((await get(`/groups/${id}`, teacher)).status).toBe(200);
    const m = (await get(`/groups/${id}/members`, teacher)).body.members[0]
      .student;
    expect(Object.keys(m).sort()).toEqual([
      "firstName",
      "id",
      "lastName",
      "status",
    ]);
    expect(
      (await get(`/groups/${id}/members?status=removed`, teacher)).status,
    ).toBe(403);
    for (const c of [teacher, platform]) {
      expect((await post("/groups", input(), c)).status).toBe(403);
      expect((await patch(`/groups/${id}`, { name: "Attack" }, c)).status).toBe(
        403,
      );
      expect((await post(`/groups/${id}/archive`, {}, c)).status).toBe(403);
      expect(
        (await post(`/groups/${id}/members`, { studentId }, c)).status,
      ).toBe(403);
      expect(
        (await post(`/groups/${id}/members/${studentId}/remove`, {}, c)).status,
      ).toBe(403);
      expect((await get("/groups/teachers", c)).status).toBe(403);
    }
    expect((await get("/groups", platform)).status).toBe(403);
    expect((await request(app).get("/api/groups")).status).toBe(401);
    expect(
      (
        await request(app)
          .post("/api/groups")
          .set("Cookie", owner)
          .send(input())
      ).status,
    ).toBe(403);
  });
  it("counts only tenant groups and memberships and preserves student statistics", async () => {
    const id = await group();
    await group();
    await post(`/groups/${id}/members`, { studentId });
    await post(`/groups/${id}/archive`);
    const d = (await get("/dashboard")).body;
    expect(d.groups).toEqual({ total: 2, active: 1, activeMemberships: 1 });
    expect(d.students.total).toBe(1);
    expect((await get("/dashboard", other)).body.groups).toEqual({
      total: 0,
      active: 0,
      activeMemberships: 0,
    });
    expect((await get("/dashboard", teacher)).body.groups).toBeUndefined();
    expect((await get("/dashboard", platform)).body.groups).toBeUndefined();
  });
  it("serializes capacity edits, archiving and duplicate removal with enrollment", async () => {
    const id = await group(2);
    const another = await student();
    const results = await Promise.all([
      post(`/groups/${id}/members`, { studentId }),
      post(`/groups/${id}/members`, { studentId: another }),
      patch(`/groups/${id}`, { capacity: 1 }),
    ]);
    expect(results.every((r) => [200, 201, 409].includes(r.status))).toBe(true);
    const g = (await Group.findById(id))!;
    expect(g.activeMemberCount).toBeLessThanOrEqual(g.capacity);
    expect(g.activeMemberCount).toBe(
      await Membership.countDocuments({ groupId: id, status: "active" }),
    );
    const active = (await Membership.findOne({
      groupId: id,
      status: "active",
    }))!;
    const removals = await Promise.all(
      [1, 2].map(() =>
        post(`/groups/${id}/members/${active.studentId}/remove`),
      ),
    );
    expect(removals.map((r) => r.status).sort()).toEqual([204, 404]);
    const archivedId = await group();
    const race = await Promise.all([
      post(`/groups/${archivedId}/archive`),
      post(`/groups/${archivedId}/members`, { studentId }),
    ]);
    expect(race[0]!.status).toBe(200);
    expect([201, 409]).toContain(race[1]!.status);
    const archived = (await Group.findById(archivedId))!;
    expect(archived.status).toBe("archived");
    expect(archived.activeMemberCount).toBe(
      await Membership.countDocuments({
        groupId: archivedId,
        status: "active",
      }),
    );
    expect(
      (await post(`/groups/${archivedId}/members`, { studentId: another }))
        .status,
    ).toBe(409);
    // Metadata edits must never silently reactivate archived groups.
    expect(
      (await patch(`/groups/${archivedId}`, { description: "Updated" })).body
        .group.status,
    ).toBe("archived");
  });
  it("rejects inactive teachers and protects the unique active enrollment index", async () => {
    await User.updateOne({ _id: teacherId }, { $set: { active: false } });
    expect((await post("/groups", input())).status).toBe(404);
    await User.updateOne({ _id: teacherId }, { $set: { active: true } });
    const id = await group();
    await post(`/groups/${id}/members`, { studentId });
    await expect(
      Membership.create({ tenantId: tenant, groupId: id, studentId }),
    ).rejects.toMatchObject({ code: 11000 });
    expect(
      (await get("/groups/teachers", admin)).body.teachers.every(
        (t: object) => Object.keys(t).sort().join(",") === "id,name",
      ),
    ).toBe(true);
  });
});
