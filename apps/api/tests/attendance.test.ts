import { beforeAll, afterAll, beforeEach, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { createApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import { connectDatabase } from "../src/db.js";
import { ensureIndexes, Tenant, User, Student } from "../src/models.js";
import { Group, Membership } from "../src/group-models.js";
import { Schedule, Classroom } from "../src/schedule-models.js";
import { LessonSession, AttendanceRecord } from "../src/attendance-models.js";
import { attendanceTotals } from "../src/attendance-service.js";
import { localDate, dayOfWeek, addDays } from "../src/schedule-time.js";
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
let tenant: mongoose.Types.ObjectId,
  owner: string,
  teacher: string,
  outsider: string,
  admin: string,
  platform: string,
  second: string;
let teacherId: string,
  secondId: string,
  groupId: string,
  scheduleId: string,
  studentId: string,
  otherStudentId: string;
const date = localDate();
async function actor(role: string, tenantId: mongoose.Types.ObjectId | null) {
  const u = await User.create({
    role,
    tenantId,
    name: "Synthetic",
    email: `${new mongoose.Types.ObjectId()}@example.test`,
    passwordHash: "unused",
  });
  return {
    id: u.id as string,
    cookie: `softlans_session=${issueToken(u, config)}`,
  };
}
const get = (path: string, cookie = owner) =>
  request(app)
    .get("/api" + path)
    .set("Cookie", cookie);
const post = (path: string, body: object = {}, cookie = owner) =>
  request(app)
    .post("/api" + path)
    .set("Cookie", cookie)
    .set("Origin", origin)
    .send(body);
const patch = (path: string, body: object, cookie = owner) =>
  request(app)
    .patch("/api" + path)
    .set("Cookie", cookie)
    .set("Origin", origin)
    .send(body);
const session = () =>
  post("/attendance/sessions", { scheduleId, lessonDate: date });
const summary = () => get(`/attendance/summary?start=${date}&end=${date}`);
beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: "7.0.24" },
  });
  await connectDatabase(repl.getUri("attendance"));
  await ensureIndexes();
});
afterAll(async () => {
  await mongoose.disconnect();
  await repl?.stop();
});
beforeEach(async () => {
  for (const m of [
    AttendanceRecord,
    LessonSession,
    Membership,
    Schedule,
    Classroom,
    Student,
    Group,
    User,
    Tenant,
  ])
    await m.deleteMany({});
  tenant = (await Tenant.create({ name: "Synthetic" }))._id;
  owner = (await actor("business_owner", tenant)).cookie;
  admin = (await actor("admin", tenant)).cookie;
  const t = await actor("teacher", tenant);
  teacher = t.cookie;
  teacherId = t.id;
  const t2 = await actor("teacher", tenant);
  second = t2.cookie;
  secondId = t2.id;
  outsider = (
    await actor("business_owner", (await Tenant.create({ name: "Other" }))._id)
  ).cookie;
  platform = (await actor("super_admin", null)).cookie;
  groupId = (
    await Group.create({
      tenantId: tenant,
      teacherId,
      name: "Test",
      courseName: "Test",
      capacity: 10,
      activeMemberCount: 1,
      monthlyFee: 0,
      startDate: "2026-01-01",
    })
  ).id as string;
  const room = await Classroom.create({
    tenantId: tenant,
    name: "Test",
    nameKey: "test",
  });
  scheduleId = (
    await Schedule.create({
      tenantId: tenant,
      groupId,
      teacherId,
      classroomId: room._id,
      dayOfWeek: dayOfWeek(date),
      startTime: "10:00",
      endTime: "11:00",
      createdAt: new Date(date + "T00:00:00+05:00"),
    })
  ).id as string;
  studentId = (
    await Student.create({
      tenantId: tenant,
      createdBy: teacherId,
      firstName: "Synthetic",
      lastName: "Student",
    })
  ).id as string;
  otherStudentId = (
    await Student.create({
      tenantId: tenant,
      createdBy: teacherId,
      firstName: "Unrelated",
      lastName: "Student",
    })
  ).id as string;
  await Membership.create({
    tenantId: tenant,
    groupId,
    studentId,
    enrolledAt: new Date("2026-01-01"),
  });
});
it("creates one occurrence under parallel requests and enforces unique indexes", async () => {
  const result = await Promise.all([session(), session(), session()]);
  expect(result.map((r) => r.status)).toEqual([200, 200, 200]);
  expect(new Set(result.map((r) => r.body.session.id)).size).toBe(1);
  expect(await LessonSession.countDocuments()).toBe(1);
  const row = (await LessonSession.findOne())!.toObject();
  delete (row as { _id?: unknown })._id;
  await expect(LessonSession.create(row)).rejects.toMatchObject({
    code: 11000,
  });
});
it("distinguishes unmarked from absent, saves bulk, corrects and reports without double counting", async () => {
  await Membership.create({
    tenantId: tenant,
    groupId,
    studentId: otherStudentId,
    enrolledAt: new Date("2026-01-01"),
  });
  const id = (await session()).body.session.id;
  const roster = (await get(`/attendance/sessions/${id}/roster`, teacher)).body;
  expect(
    roster.students.every((s: { status: null }) => s.status === null),
  ).toBe(true);
  expect((await summary()).body).toMatchObject({
    unmarked: 2,
    absent: 0,
    attendancePercentage: null,
    coveragePercentage: 0,
  });
  const path = `/attendance/sessions/${id}/attendance`;
  expect(
    (
      await post(
        path,
        {
          revision: 0,
          records: [
            { studentId, status: "present" },
            { studentId: otherStudentId, status: "excused" },
          ],
        },
        teacher,
      )
    ).body.session.status,
  ).toBe("completed");
  expect(
    (
      await patch(
        path,
        {
          revision: 1,
          records: [{ studentId, status: "absent", note: "Test" }],
        },
        admin,
      )
    ).status,
  ).toBe(200);
  expect((await summary()).body).toMatchObject({
    absent: 1,
    excused: 1,
    marked: 2,
    completedSessions: 1,
    attendancePercentage: 0,
    coveragePercentage: 100,
  });
  expect(await AttendanceRecord.countDocuments()).toBe(2);
  expect(
    (
      await get(
        `/attendance/summary?start=${date}&end=${date}&studentId=${studentId}`,
      )
    ).body,
  ).toMatchObject({
    absent: 1,
    excused: 0,
    marked: 1,
    coveragePercentage: 100,
  });
  const existing = (await AttendanceRecord.findOne())!.toObject();
  delete (existing as { _id?: unknown })._id;
  await expect(AttendanceRecord.create(existing)).rejects.toMatchObject({
    code: 11000,
  });
  expect(
    (await post(`/groups/${groupId}/members/${studentId}/remove`)).status,
  ).toBe(204);
  expect(
    (await get(`/attendance/sessions/${id}/roster`)).body.students,
  ).toHaveLength(2);

  expect(
    (
      await get(
        `/attendance/groups/${groupId}/history?start=${date}&end=${date}`,
      )
    ).body.total,
  ).toBe(1);
  expect(
    (
      await get(
        `/attendance/students/${studentId}/history?start=${date}&end=${date}`,
      )
    ).body.total,
  ).toBe(1);
});
it("rejects foreign students, duplicate payloads, mass assignment, missing CSRF and stale concurrent saves atomically", async () => {
  const id = (await session()).body.session.id,
    path = `/attendance/sessions/${id}/attendance`;
  expect(
    (
      await post(path, {
        revision: 0,
        records: [
          { studentId, status: "present" },
          { studentId: otherStudentId, status: "absent" },
        ],
      })
    ).status,
  ).toBe(400);
  expect(await AttendanceRecord.countDocuments()).toBe(0);
  const payload = { revision: 0, records: [{ studentId, status: "late" }] };
  expect(
    (await post(path, { ...payload, tenantId: tenant.toString() })).status,
  ).toBe(400);
  expect(
    (
      await post(path, {
        ...payload,
        records: [...payload.records, ...payload.records],
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await post(path, {
        ...payload,
        records: [{ ...payload.records[0], markedBy: teacherId }],
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await request(app)
        .post("/api" + path)
        .set("Cookie", owner)
        .send(payload)
    ).status,
  ).toBe(403);
  const results = await Promise.all([
    post(path, payload),
    post(path, { ...payload, records: [{ studentId, status: "absent" }] }),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(await AttendanceRecord.countDocuments()).toBe(1);
});
it("enforces tenant isolation, RBAC and historical protection after teacher reassignment", async () => {
  const id = (await session()).body.session.id;
  for (const cookie of [outsider, second]) {
    expect(
      (await get(`/attendance/sessions/${id}/roster`, cookie)).status,
    ).toBe(404);
    expect(
      (
        await post(
          `/attendance/sessions/${id}/attendance`,
          { revision: 0, records: [{ studentId, status: "present" }] },
          cookie,
        )
      ).status,
    ).toBe(404);
    expect(
      (await get(`/attendance/sessions?groupId=${groupId}`, cookie)).body
        .sessions ?? [],
    ).toHaveLength(0);
  }
  expect((await get("/attendance/sessions", platform)).status).toBe(403);
  expect((await get("/billing/charges", teacher)).status).toBe(403);
  expect((await get("/dashboard", teacher)).body.financial).toBeUndefined();
  await Group.updateOne({ _id: groupId }, { teacherId: secondId });
  await Schedule.updateOne({ _id: scheduleId }, { teacherId: secondId });
  for (const cookie of [teacher, second])
    expect(
      (await get(`/attendance/sessions/${id}/roster`, cookie)).status,
    ).toBe(404);
  expect((await get(`/attendance/sessions/${id}/roster`, admin)).status).toBe(
    200,
  );
});
it("uses historical enrollment intervals even before first session creation and preserves frozen rosters", async () => {
  await Membership.updateOne(
    { tenantId: tenant, studentId },
    { status: "removed", removedAt: new Date(date + "T12:00:00+05:00") },
  );
  await Membership.create({
    tenantId: tenant,
    groupId,
    studentId: otherStudentId,
    enrolledAt: new Date(date + "T12:00:00+05:00"),
  });
  const id = (await session()).body.session.id;
  expect(
    (await get(`/attendance/sessions/${id}/roster`)).body.students.map(
      (s: { studentId: string }) => s.studentId,
    ),
  ).toEqual([studentId]);
  await Membership.updateOne(
    { studentId: otherStudentId },
    { enrolledAt: new Date("2026-01-01") },
  );
  expect(
    (await get(`/attendance/sessions/${id}/roster`)).body.students,
  ).toHaveLength(1);
});
it("snapshots occurrences before schedule edits and cancellation excludes records from analytics", async () => {
  expect(
    (
      await patch(`/schedules/${scheduleId}`, {
        startTime: "11:00",
        endTime: "12:00",
      })
    ).status,
  ).toBe(200);
  const s = (await session()).body.session;
  expect(s.startTime).toBe("10:00");
  expect(
    (
      await patch(
        `/attendance/sessions/${s.id}`,
        { revision: 0, status: "cancelled" },
        teacher,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await patch(`/attendance/sessions/${s.id}`, {
        revision: 0,
        status: "cancelled",
      })
    ).status,
  ).toBe(200);
  expect((await summary()).body).toMatchObject({
    totalSessions: 0,
    cancelledSessions: 1,
    marked: 0,
  });
  expect(
    (
      await post(`/attendance/sessions/${s.id}/attendance`, {
        revision: 1,
        records: [{ studentId, status: "present" }],
      })
    ).status,
  ).toBe(409);
});
it("bounds ranges, validates occurrences and uses Tashkent midnight", async () => {
  expect((await request(app).get("/api/attendance/sessions")).status).toBe(401);
  expect(localDate(new Date("2026-10-29T19:00:00Z"))).toBe("2026-10-30");
  expect(localDate(new Date("2026-10-29T18:59:59Z"))).toBe("2026-10-29");
  expect(
    (
      await post("/attendance/sessions", {
        scheduleId,
        lessonDate: addDays(date, 1),
      })
    ).status,
  ).toBe(400);
  expect(
    (await get("/attendance/sessions?start=2026-01-01&end=2026-12-31")).status,
  ).toBe(400);
  expect(
    (
      await post("/attendance/sessions", {
        scheduleId,
        lessonDate: addDays(date, -1),
      })
    ).status,
  ).toBe(404);
  const dashboard = (await get("/dashboard")).body;
  expect(dashboard.attendance).toMatchObject({
    totalSessions: 1,
    awaitingSessions: 1,
  });
});
it("calculates explicit percentages excluding unmarked without rounding drift", () => {
  expect(
    attendanceTotals(["present", "late", "absent", "excused"], 5),
  ).toMatchObject({
    attendancePercentage: 50,
    coveragePercentage: 80,
    unmarked: 1,
  });
  expect(attendanceTotals([], 0).attendancePercentage).toBeNull();
  expect(
    attendanceTotals(["present", "absent", "absent"], 3).attendancePercentage,
  ).toBe(33.33);
});
