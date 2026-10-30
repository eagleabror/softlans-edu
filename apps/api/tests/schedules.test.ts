import { beforeAll, afterAll, beforeEach, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { createApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import { connectDatabase } from "../src/db.js";
import { ensureIndexes, Tenant, User } from "../src/models.js";
import { Group } from "../src/group-models.js";
import { Classroom, Schedule } from "../src/schedule-models.js";
import { scheduleStatistics } from "../src/schedules.js";
import { issueToken } from "../src/security.js";
import {
  localDate,
  weekStart,
  occursBetween,
  rangesOverlap,
} from "../src/schedule-time.js";
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
  secondTeacher: string,
  platform: string,
  other: string,
  teacherId: string,
  secondTeacherId: string,
  groupId: string,
  roomId: string;
async function actor(
  role: "business_owner" | "admin" | "teacher" | "super_admin",
  tenantId: mongoose.Types.ObjectId | null,
) {
  const u = await User.create({
    role,
    tenantId,
    name: "Synthetic Test",
    email: `${new mongoose.Types.ObjectId()}@example.test`,
    passwordHash: "unused",
  });
  return {
    id: u.id as string,
    cookie: `softlans_session=${issueToken(u, config)}`,
  };
}
const get = (path: string, c = owner) =>
  request(app)
    .get("/api" + path)
    .set("Cookie", c);
const post = (path: string, body: object = {}, c = owner) =>
  request(app)
    .post("/api" + path)
    .set("Cookie", c)
    .set("Origin", origin)
    .send(body);
const patch = (path: string, body: object, c = owner) =>
  request(app)
    .patch("/api" + path)
    .set("Cookie", c)
    .set("Origin", origin)
    .send(body);
const input = () => ({
  groupId,
  teacherId,
  classroomId: roomId,
  dayOfWeek: 1,
  startTime: "10:00",
  endTime: "11:00",
});
async function group(t = teacherId) {
  return (
    await Group.create({
      tenantId: tenant,
      teacherId: t,
      name: "Synthetic group",
      courseName: "Test",
      capacity: 10,
      monthlyFee: 0,
      startDate: "2026-01-01",
    })
  ).id as string;
}
beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: "7.0.24" },
  });
  await connectDatabase(repl.getUri("schedules"));
  await ensureIndexes();
});
afterAll(async () => {
  await mongoose.disconnect();
  await repl?.stop();
});
beforeEach(async () => {
  await Promise.all([
    Schedule.deleteMany({}),
    Classroom.deleteMany({}),
    Group.deleteMany({}),
    User.deleteMany({}),
    Tenant.deleteMany({}),
  ]);
  tenant = (await Tenant.create({ name: "Synthetic A" }))._id;
  otherTenant = (await Tenant.create({ name: "Synthetic B" }))._id;
  owner = (await actor("business_owner", tenant)).cookie;
  admin = (await actor("admin", tenant)).cookie;
  const t = await actor("teacher", tenant);
  teacher = t.cookie;
  teacherId = t.id;
  const t2 = await actor("teacher", tenant);
  secondTeacher = t2.cookie;
  secondTeacherId = t2.id;
  platform = (await actor("super_admin", null)).cookie;
  other = (await actor("business_owner", otherTenant)).cookie;
  groupId = await group();
  roomId = (await post("/classrooms", { name: "Test room" })).body.classroom.id;
});
it("validates classrooms and prevents normalized duplicate names within a tenant", async () => {
  expect((await post("/classrooms", { name: " test ROOM " })).status).toBe(409);
  expect((await post("/classrooms", { name: "Test room" }, other)).status).toBe(
    201,
  );
  for (const body of [
    { name: "" },
    { name: "New", capacity: -1 },
    { name: "New", capacity: 1.5 },
    { name: "New", tenantId: otherTenant.toString() },
  ])
    expect((await post("/classrooms", body)).status).toBe(400);
  expect(
    (
      await patch(
        `/classrooms/${roomId}`,
        { capacity: 20, description: "Synthetic", name: "Updated" },
        admin,
      )
    ).status,
  ).toBe(200);
  expect((await get(`/classrooms/${roomId}`)).body.classroom.capacity).toBe(20);
});
it("creates, edits, deactivates and reactivates recurring lessons", async () => {
  const r = await post("/schedules", input(), admin);
  expect(r.status).toBe(201);
  const id = r.body.schedule.id;
  expect((await patch(`/schedules/${id}`, { startTime: "09:00" })).status).toBe(
    200,
  );
  expect((await patch(`/schedules/${id}`, { endTime: "08:00" })).status).toBe(
    400,
  );
  expect((await post(`/schedules/${id}/deactivate`)).body.schedule.status).toBe(
    "inactive",
  );
  expect((await get(`/schedules/${id}`)).status).toBe(200);
  expect((await patch(`/schedules/${id}`, { status: "active" })).status).toBe(
    200,
  );
});
it("rejects malformed intervals, dates, fields and mass assignment", async () => {
  for (const update of [
    { startTime: "11:00" },
    { endTime: "09:00" },
    { startTime: "9:00" },
    { dayOfWeek: 0 },
    { dayOfWeek: 8 },
    { effectiveFrom: "2026-02-30" },
    { effectiveFrom: "2026-11-02", effectiveUntil: "2026-11-01" },
    { tenantId: tenant.toString() },
    { timezone: "UTC" },
  ])
    expect((await post("/schedules", { ...input(), ...update })).status).toBe(
      400,
    );
});
it("rejects group conflicts and permits adjacent half-open intervals and different days", async () => {
  expect((await post("/schedules", input())).status).toBe(201);
  const conflict = await post("/schedules", {
    ...input(),
    startTime: "10:30",
    endTime: "11:30",
  });
  expect(conflict.status).toBe(409);
  expect(conflict.body.error.message).toContain("Guruh");
  expect(
    (
      await post("/schedules", {
        ...input(),
        startTime: "11:00",
        endTime: "12:00",
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await post("/schedules", {
        ...input(),
        startTime: "09:00",
        endTime: "10:00",
      })
    ).status,
  ).toBe(201);
  expect((await post("/schedules", { ...input(), dayOfWeek: 2 })).status).toBe(
    201,
  );
});
it("rejects teacher conflicts across different groups and rooms", async () => {
  await post("/schedules", input());
  const g2 = await group();
  const r2 = (await post("/classrooms", { name: "Second" })).body.classroom.id;
  const result = await post("/schedules", {
    ...input(),
    groupId: g2,
    classroomId: r2,
  });
  expect(result.status).toBe(409);
  expect(result.body.error.message).toContain("O‘qituvchi");
});
it("rejects classroom conflicts across different teachers and groups", async () => {
  await post("/schedules", input());
  const g2 = await group(secondTeacherId);
  const result = await post("/schedules", {
    ...input(),
    groupId: g2,
    teacherId: secondTeacherId,
  });
  expect(result.status).toBe(409);
  expect(result.body.error.message).toContain("Xona");
});
it("checks conflicts when editing and reactivating", async () => {
  await post("/schedules", input());
  const second = await post("/schedules", {
    ...input(),
    startTime: "12:00",
    endTime: "13:00",
  });
  const id = second.body.schedule.id;
  expect((await patch(`/schedules/${id}`, { startTime: "10:30" })).status).toBe(
    409,
  );
  await post(`/schedules/${id}/deactivate`);
  expect((await patch(`/schedules/${id}`, { startTime: "10:30" })).status).toBe(
    200,
  );
  expect((await patch(`/schedules/${id}`, { status: "active" })).status).toBe(
    409,
  );
});
it("respects inclusive effective ranges and actual weekday occurrences", async () => {
  expect(
    (
      await post("/schedules", {
        ...input(),
        effectiveFrom: "2026-11-02",
        effectiveUntil: "2026-11-02",
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await post("/schedules", {
        ...input(),
        effectiveFrom: "2026-11-03",
        effectiveUntil: "2026-11-09",
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await post("/schedules", {
        ...input(),
        effectiveFrom: "2026-11-02",
        effectiveUntil: "2026-11-03",
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await post("/schedules", {
        ...input(),
        effectiveFrom: "2026-11-03",
        effectiveUntil: "2026-11-04",
      })
    ).status,
  ).toBe(201);
});
it("serializes concurrent conflicting inserts on the database", async () => {
  const responses = await Promise.all(
    Array.from({ length: 5 }, () => post("/schedules", input())),
  );
  expect(responses.map((r) => r.status).sort()).toEqual([
    201, 409, 409, 409, 409,
  ]);
  expect(await Schedule.countDocuments({})).toBe(1);
});
it("serializes concurrent edits into a conflicting time", async () => {
  const a = await post("/schedules", {
    ...input(),
    startTime: "08:00",
    endTime: "09:00",
  });
  const b = await post("/schedules", {
    ...input(),
    startTime: "12:00",
    endTime: "13:00",
  });
  const results = await Promise.all(
    [a, b].map((r) =>
      patch(`/schedules/${r.body.schedule.id}`, {
        startTime: "10:00",
        endTime: "11:00",
      }),
    ),
  );
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
});
it("protects classroom status and group teacher changes, retaining history", async () => {
  const r = await post("/schedules", input());
  expect((await post(`/classrooms/${roomId}/deactivate`)).status).toBe(409);
  expect(
    (await patch(`/groups/${groupId}/teacher`, { teacherId: secondTeacherId }))
      .status,
  ).toBe(409);
  expect(
    (await patch(`/groups/${groupId}`, { teacherId: secondTeacherId })).status,
  ).toBe(409);
  expect((await post(`/groups/${groupId}/archive`)).status).toBe(409);
  await post(`/schedules/${r.body.schedule.id}/deactivate`);
  expect((await post(`/classrooms/${roomId}/deactivate`)).status).toBe(200);
  expect(
    (await patch(`/groups/${groupId}/teacher`, { teacherId: secondTeacherId }))
      .status,
  ).toBe(200);
  expect(
    (await get(`/schedules/${r.body.schedule.id}`)).body.schedule.teacherId,
  ).toBe(teacherId);
  expect((await post("/schedules", input())).status).toBe(404);
  expect(
    (
      await patch(`/schedules/${r.body.schedule.id}`, {
        startTime: "09:00",
        teacherId,
        groupId,
      })
    ).status,
  ).toBe(200);
});
it("serializes classroom retirement and lesson creation", async () => {
  const [a, b] = await Promise.all([
    post("/schedules", input()),
    post(`/classrooms/${roomId}/deactivate`),
  ]);
  expect([a.status, b.status]).not.toEqual([201, 200]);
  expect(await Schedule.countDocuments({ status: "active" })).toBe(
    (await Classroom.findById(roomId))?.status === "inactive" ? 0 : 1,
  );
});
it("serializes teacher reassignment and lesson creation", async () => {
  const [a, b] = await Promise.all([
    post("/schedules", input()),
    patch(`/groups/${groupId}/teacher`, { teacherId: secondTeacherId }),
  ]);
  expect([a.status, b.status]).not.toEqual([201, 200]);
  const g = await Group.findById(groupId);
  for (const s of await Schedule.find({ status: "active" }))
    expect(s.teacherId.toString()).toBe(g?.teacherId.toString());
});
it("enforces teacher read-only scope and denies platform access", async () => {
  const r = await post("/schedules", input());
  const id = r.body.schedule.id;
  expect((await get("/schedules", teacher)).body.total).toBe(1);
  expect((await get("/schedules", secondTeacher)).body.total).toBe(0);
  expect((await get(`/schedules/${id}`, secondTeacher)).status).toBe(404);
  expect(
    (await get(`/schedules?teacherId=${teacherId}`, secondTeacher)).status,
  ).toBe(403);
  for (const c of [teacher, platform]) {
    expect((await post("/schedules", input(), c)).status).toBe(403);
    expect(
      (await patch(`/schedules/${id}`, { status: "inactive" }, c)).status,
    ).toBe(403);
    expect((await post(`/schedules/${id}/deactivate`, {}, c)).status).toBe(403);
    expect((await get("/classrooms", c)).status).toBe(403);
  }
  expect((await get("/schedules/weekly", platform)).status).toBe(403);
  expect((await request(app).get("/api/schedules")).status).toBe(401);
});
it("rejects IDOR, cross-tenant references and mismatched teachers", async () => {
  const row = await post("/schedules", input());
  for (const path of [
    `/schedules/${row.body.schedule.id}`,
    `/classrooms/${roomId}`,
  ]) {
    expect((await get(path, other)).status).toBe(404);
    expect((await patch(path, { status: "inactive" }, other)).status).toBe(404);
  }
  const foreignTeacher = await actor("teacher", otherTenant);
  const foreignRoom = (await post("/classrooms", { name: "Foreign" }, other))
    .body.classroom.id;
  for (const refs of [
    { teacherId: foreignTeacher.id },
    { classroomId: foreignRoom },
    { groupId: new mongoose.Types.ObjectId().toString() },
  ])
    expect((await post("/schedules", { ...input(), ...refs })).status).toBe(
      404,
    );
  expect(
    (await post("/schedules", { ...input(), teacherId: secondTeacherId }))
      .status,
  ).toBe(409);
  expect((await get("/schedules", other)).body.total).toBe(0);
});
it("returns filtered paginated weekly occurrences and correct dashboard counts", async () => {
  await post("/schedules", {
    ...input(),
    effectiveFrom: "2026-11-02",
    effectiveUntil: "2026-11-02",
  });
  await post("/schedules", { ...input(), dayOfWeek: 2 });
  const weekly = await get(
    `/schedules/weekly?date=2026-11-04&groupId=${groupId}&pageSize=1`,
  );
  expect(weekly.status).toBe(200);
  expect(weekly.body).toMatchObject({
    total: 2,
    weekStart: "2026-11-02",
    weekEnd: "2026-11-08",
    timezone: "Asia/Tashkent",
  });
  expect(weekly.body.schedules[0].date).toBe("2026-11-02");
  expect(
    (await get("/schedules/weekly?date=2026-11-04&pageSize=1&page=2")).body
      .schedules[0].date,
  ).toBe("2026-11-03");
  expect(
    (await get("/schedules/weekly?date=2026-11-11&dayOfWeek=1")).body.total,
  ).toBe(0);
  expect(
    (await get("/schedules/weekly?date=2026-11-04", secondTeacher)).body.total,
  ).toBe(0);
  expect(
    (
      await get(
        `/schedules?classroomId=${roomId}&teacherId=${teacherId}&dayOfWeek=2`,
      )
    ).body.total,
  ).toBe(1);
  const dashboard = await get("/dashboard");
  expect(dashboard.body.scheduling.activeClassrooms).toBe(1);
  expect(dashboard.body.groups.total).toBe(1);
  expect(dashboard.body.students.total).toBe(0);
});
it("preserves CSRF origin validation", async () => {
  expect(
    (
      await request(app)
        .post("/api/schedules")
        .set("Cookie", owner)
        .set("Origin", "https://evil.example")
        .send(input())
    ).status,
  ).toBe(403);
});
it("handles Tashkent midnight, week and year boundaries independently of server timezone", () => {
  expect(localDate(new Date("2026-11-01T18:59:59Z"))).toBe("2026-11-01");
  expect(localDate(new Date("2026-11-01T19:00:00Z"))).toBe("2026-11-02");
  expect(localDate(new Date("2026-12-31T19:00:00Z"))).toBe("2027-01-01");
  expect(weekStart("2027-01-01")).toBe("2026-12-28");
  expect(occursBetween({ dayOfWeek: 1 }, "2026-11-02", "2026-11-02")).toBe(
    true,
  );
  expect(
    rangesOverlap(
      {
        dayOfWeek: 1,
        effectiveFrom: "2026-11-03",
        effectiveUntil: "2026-11-04",
      },
      { dayOfWeek: 1 },
    ),
  ).toBe(false);
});

it("validates tenant references even on inactive creation and editing", async () => {
  const foreign = (await post("/classrooms", { name: "Foreign" }, other)).body
    .classroom.id;
  expect(
    (
      await post("/schedules", {
        ...input(),
        status: "inactive",
        classroomId: foreign,
      })
    ).status,
  ).toBe(404);
  const r = await post("/schedules", { ...input(), status: "inactive" });
  expect(r.status).toBe(201);
  expect(
    (await patch(`/schedules/${r.body.schedule.id}`, { classroomId: foreign }))
      .status,
  ).toBe(404);
});
it("counts today and current week across Tashkent midnight", async () => {
  await post("/schedules", { ...input(), effectiveFrom: "2026-11-02" });
  expect(
    await scheduleStatistics(
      { tenantId: tenant },
      new Date("2026-11-01T18:59:59Z"),
    ),
  ).toMatchObject({ todayLessons: 0, weeklyLessons: 0, activeClassrooms: 1 });
  expect(
    await scheduleStatistics(
      { tenantId: tenant },
      new Date("2026-11-01T19:00:00Z"),
    ),
  ).toMatchObject({ todayLessons: 1, weeklyLessons: 1 });
});
it("preserves inactive classroom status on ordinary edits", async () => {
  await post(`/classrooms/${roomId}/deactivate`);
  expect(
    (await patch(`/classrooms/${roomId}`, { description: "Updated" })).body
      .classroom.status,
  ).toBe("inactive");
});
it("serializes independent groups competing for a teacher or classroom", async () => {
  const g2 = await group();
  const r2 = (await post("/classrooms", { name: "Second room" })).body.classroom
    .id;
  const teacherResults = await Promise.all([
    post("/schedules", input()),
    post("/schedules", { ...input(), groupId: g2, classroomId: r2 }),
  ]);
  expect(teacherResults.map((r) => r.status).sort()).toEqual([201, 409]);
  await Schedule.deleteMany({});
  const g3 = await group(secondTeacherId);
  const roomResults = await Promise.all([
    post("/schedules", input()),
    post("/schedules", { ...input(), groupId: g3, teacherId: secondTeacherId }),
  ]);
  expect(roomResults.map((r) => r.status).sort()).toEqual([201, 409]);
});
