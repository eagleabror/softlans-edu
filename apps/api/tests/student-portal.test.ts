import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import type { Role } from "@softlans/contracts";
import { createApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import { connectDatabase } from "../src/db.js";
import { ensureIndexes, Student, Tenant, User } from "../src/models.js";
import { Group, Membership } from "../src/group-models.js";
import { Classroom, Schedule } from "../src/schedule-models.js";
import { AttendanceRecord, LessonSession } from "../src/attendance-models.js";
import { Charge, Payment, PaymentReversal } from "../src/billing-models.js";
import { createSession } from "../src/security.js";
import { newSecret, seal, totp } from "../src/mfa-crypto.js";
import { addDays, dayOfWeek, localDate } from "../src/schedule-time.js";
import { Subscription } from "../src/saas-models.js";

const origin = "http://localhost:5173",
  password = "synthetic-student-password";
const config = parseConfig({
  NODE_ENV: "test",
  APP_ORIGIN: origin,
  MONGODB_URI: "mongodb://localhost:27017/test",
  JWT_SECRET: randomBytes(48).toString("hex"),
  MFA_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
});
let repl: MongoMemoryReplSet, app: ReturnType<typeof createApp>, hash: string;
let tenant: mongoose.Types.ObjectId,
  foreignTenant: mongoose.Types.ObjectId,
  ownerId: mongoose.Types.ObjectId,
  teacherId: mongoose.Types.ObjectId;
let owner: string,
  admin: string,
  teacher: string,
  foreign: string,
  studentCookie: string,
  peerCookie: string;
let student: InstanceType<typeof Student>,
  peer: InstanceType<typeof Student>,
  studentUser: InstanceType<typeof User>;
let group: InstanceType<typeof Group>, schedule: InstanceType<typeof Schedule>;
const get = (path: string, cookie = studentCookie) =>
  request(app).get(path).set("Cookie", cookie);
const post = (path: string, body: object, cookie = owner) =>
  request(app)
    .post(path)
    .set("Cookie", cookie)
    .set("Origin", origin)
    .send(body);
async function actor(
  role: Role,
  tenantId: mongoose.Types.ObjectId | null,
  studentId?: mongoose.Types.ObjectId,
) {
  const user = await User.create({
    role,
    tenantId,
    ...(studentId ? { studentId } : {}),
    name: "Sun’iy hisob",
    email: `${new mongoose.Types.ObjectId()}@synthetic.test`,
    passwordHash: hash,
  });
  return {
    user,
    cookie: `softlans_session=${await createSession(user, config)}`,
  };
}
async function makeStudent(tenantId = tenant) {
  return Student.create({
    tenantId,
    firstName: "Sinov",
    lastName: "O‘quvchi",
    createdBy: ownerId,
    enrollmentDate: "2020-01-01",
    notes: "PRIVATE_CRM_NOTE",
    parentPhone: "+998000000000",
  });
}
async function lesson(date: string, options: Record<string, unknown> = {}) {
  return LessonSession.create({
    tenantId: tenant,
    groupId: group._id,
    scheduleId: schedule._id,
    teacherId,
    groupName: "Saqlangan guruh nomi",
    lessonDate: date,
    startTime: "10:00",
    endTime: "11:00",
    roster: [student._id, peer._id],
    ...options,
  });
}
async function charge(
  studentId = student._id,
  extra: Record<string, unknown> = {},
) {
  return Charge.create({
    tenantId: tenant,
    studentId,
    groupId: group._id,
    generatedBy: ownerId,
    billingMonth: "2020-01",
    originalAmount: 300000,
    finalAmount: 300000,
    paidAmount: 100000,
    dueDate: "2020-01-10T18:59:59Z",
    ...extra,
  });
}
beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: "7.0.24" },
  });
  await connectDatabase(repl.getUri("softlans_student_portal_test"));
  await ensureIndexes();
  hash = await bcrypt.hash(password, 12);
});
beforeEach(async () => {
  await Promise.all(
    Object.values(mongoose.connection.collections).map((collection) =>
      collection.deleteMany({}),
    ),
  );
  tenant = (await Tenant.create({ name: "Sinov markazi" }))._id;
  foreignTenant = (await Tenant.create({ name: "Boshqa markaz" }))._id;
  const o = await actor("business_owner", tenant);
  owner = o.cookie;
  ownerId = o.user._id;
  admin = (await actor("admin", tenant)).cookie;
  const t = await actor("teacher", tenant);
  teacher = t.cookie;
  teacherId = t.user._id;
  foreign = (await actor("business_owner", foreignTenant)).cookie;
  student = await makeStudent();
  peer = await makeStudent();
  const account = await actor("student", tenant, student._id);
  studentCookie = account.cookie;
  studentUser = account.user;
  peerCookie = (await actor("student", tenant, peer._id)).cookie;
  group = await Group.create({
    tenantId: tenant,
    teacherId,
    name: "Sinov guruhi",
    courseName: "Ingliz tili",
    capacity: 20,
    monthlyFee: 300000,
    status: "active",
    startDate: "2020-01-01",
  });
  await Membership.create({
    tenantId: tenant,
    groupId: group._id,
    studentId: student._id,
    enrolledAt: "2020-01-01",
  });
  const room = await Classroom.create({
    tenantId: tenant,
    name: "101-xona",
    nameKey: "101-xona",
  });
  schedule = await Schedule.create({
    tenantId: tenant,
    groupId: group._id,
    teacherId,
    classroomId: room._id,
    dayOfWeek: dayOfWeek(localDate()),
    startTime: "16:00",
    endTime: "17:30",
    createdAt: new Date("2020-01-01"),
  });
  app = createApp(config);
});
afterAll(async () => {
  await mongoose.disconnect();
  await repl?.stop();
});

describe("student account provisioning", () => {
  it("opens a linked account, hashes its password, logs in and excludes it from staff lists", async () => {
    const fresh = await makeStudent();
    expect(
      (await get(`/api/students/${fresh.id}/account`, owner)).body,
    ).toEqual({ account: null });
    const response = await post(
      `/api/students/${fresh.id}/account`,
      { email: " Student@Synthetic.Test ", password },
      admin,
    );
    expect(response.status).toBe(201);
    expect(response.body.account).toMatchObject({
      email: "student@synthetic.test",
      active: true,
    });
    expect(JSON.stringify(response.body)).not.toContain(password);
    const stored = await User.findById(response.body.account.id).select(
      "+passwordHash",
    );
    expect(stored?.studentId?.equals(fresh._id)).toBe(true);
    expect(await bcrypt.compare(password, stored!.passwordHash)).toBe(true);
    const login = await post(
      "/api/auth/login",
      { email: "student@synthetic.test", password },
      "",
    );
    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe("student");
    const cookie = login.headers["set-cookie"][0].split(";")[0];
    expect((await get("/api/student/profile", cookie)).body.name).toBe(
      "Sinov O‘quvchi",
    );
    expect((await get("/api/team", owner)).body.total).toBe(3);
    expect(
      (await get("/api/team", owner)).body.users.every(
        (u: { role: string }) => u.role !== "student",
      ),
    ).toBe(true);
    expect((await get(`/api/team/${stored!.id}`, owner)).status).toBe(404);
    expect((await get("/api/dashboard", owner)).body.teamCount).toBe(3);
  });
  it("rejects duplicate emails and concurrent duplicate links without creating orphan accounts", async () => {
    const fresh = await makeStudent(),
      path = `/api/students/${fresh.id}/account`;
    const results = await Promise.all([
      post(path, { email: "one@synthetic.test", password }),
      post(path, { email: "two@synthetic.test", password }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await User.countDocuments({ studentId: fresh._id })).toBe(1);
    const otherStudent = await makeStudent();
    expect(
      (
        await post(`/api/students/${otherStudent.id}/account`, {
          email: studentUser.email,
          password,
        })
      ).status,
    ).toBe(409);
    expect(await User.countDocuments({ studentId: otherStudent._id })).toBe(0);
  });
  it("enforces tenant, role, validation and CSRF boundaries", async () => {
    const fresh = await makeStudent(),
      path = `/api/students/${fresh.id}/account`,
      input = { email: "new@synthetic.test", password };
    for (const cookie of [teacher, studentCookie, peerCookie, ""]) {
      expect((await post(path, input, cookie)).status).toBe(cookie ? 403 : 401);
      expect((await get(path, cookie)).status).toBe(cookie ? 403 : 401);
    }
    expect((await get(path, foreign)).status).toBe(404);
    expect((await post(path, input, foreign)).status).toBe(404);
    for (const extra of [
      { role: "admin" },
      { studentId: peer.id },
      { tenantId: foreignTenant.toString() },
      { password: "short" },
      { email: { $ne: "" } },
    ])
      expect((await post(path, { ...input, ...extra })).status).toBe(400);
    expect(
      (
        await request(app)
          .post(path)
          .set("Cookie", owner)
          .set("Origin", "https://evil.test")
          .send(input)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post(path)
          .set("Cookie", owner)
          .set("Origin", origin)
          .type("form")
          .send(input)
      ).status,
    ).toBe(415);
    await Student.updateOne(
      { _id: fresh._id },
      { $set: { status: "archived" } },
    );
    expect((await post(path, input)).status).toBe(409);
  });
  it("requires a student link only for student users and keeps staff documents compatible", async () => {
    await expect(
      User.create({
        tenantId: tenant,
        role: "student",
        name: "Invalid",
        email: "invalid@synthetic.test",
        passwordHash: hash,
      }),
    ).rejects.toThrow();
    await expect(
      User.create({
        tenantId: tenant,
        role: "teacher",
        studentId: student._id,
        name: "Invalid",
        email: "invalid2@synthetic.test",
        passwordHash: hash,
      }),
    ).rejects.toThrow();
    await expect(
      User.create({
        tenantId: tenant,
        role: "student",
        studentId: student._id,
        name: "Duplicate",
        email: "invalid3@synthetic.test",
        passwordHash: hash,
      }),
    ).rejects.toThrow();
  });
});

describe("student read boundaries and lifecycle", () => {
  const paths = [
    "/profile",
    "/dashboard",
    "/schedule",
    "/attendance",
    "/charges",
    "/payments",
  ];
  it("uses server identity, returns safe profile data and denies CRM APIs", async () => {
    const profile = await get("/api/student/profile").set(
      "X-Tenant-ID",
      foreignTenant.toString(),
    );
    expect(profile.status).toBe(200);
    expect(profile.body).toMatchObject({
      name: "Sinov O‘quvchi",
      centerName: "Sinov markazi",
    });
    expect(JSON.stringify(profile.body)).not.toMatch(
      /PRIVATE_CRM_NOTE|parentPhone|passwordHash|tenantId|studentId/,
    );
    for (const path of paths) {
      expect(
        (await get(`/api/student${path}?studentId=${peer.id}`)).status,
      ).toBe(400);
      expect((await get(`/api/student${path}`, owner)).status).toBe(403);
      expect((await get(`/api/student${path}`, "")).status).toBe(401);
      expect((await get(`/api/student${path}`)).headers["cache-control"]).toBe(
        "no-store",
      );
    }
    for (const path of [
      "/dashboard",
      "/team",
      "/students",
      "/groups",
      "/schedules",
      "/attendance",
      "/billing/charges",
      "/debts",
      "/payroll",
      "/cash/expenses",
      "/analytics/attendance",
      "/saas/entitlement",
    ])
      expect((await get(`/api${path}`)).status, path).toBe(403);
    expect(
      (await post("/api/student/payments", { amount: 1000 }, studentCookie))
        .status,
    ).toBe(404);
    expect(
      (await post("/api/billing/payments", {}, studentCookie)).status,
    ).toBe(403);
    expect(
      (
        await post("/api/team", {
          name: "Injected",
          email: "injected@synthetic.test",
          password,
          role: "student",
        })
      ).status,
    ).toBe(400);
  });
  it("keeps paused history available, revokes archived sessions and rejects missing or foreign links", async () => {
    await Student.updateOne(
      { _id: student._id },
      { $set: { status: "paused" } },
    );
    expect((await get("/api/student/profile")).status).toBe(200);
    const archive = await request(app)
      .patch(`/api/students/${student.id}/status`)
      .set("Cookie", owner)
      .set("Origin", origin)
      .send({ status: "archived" });
    expect(archive.status).toBe(200);
    expect((await get("/api/student/profile")).status).toBe(401);
    expect(
      (
        await post(
          "/api/auth/login",
          { email: studentUser.email, password },
          "",
        )
      ).status,
    ).toBe(401);
    await Student.updateOne(
      { _id: student._id },
      { $set: { status: "active" } },
    );
    expect((await get("/api/student/profile")).status).toBe(401); // restoring status must not restore old sessions
    const login = await post(
      "/api/auth/login",
      { email: studentUser.email, password },
      "",
    );
    expect(login.status).toBe(200);
    const cookie = login.headers["set-cookie"][0].split(";")[0];
    await Student.updateOne(
      { _id: student._id },
      { $set: { tenantId: foreignTenant } },
      { overwriteImmutable: true },
    );
    expect((await get("/api/student/profile", cookie)).status).toBe(401);
  });
  it("rechecks the student profile when completing an outstanding MFA challenge", async () => {
    const secret = newSecret();
    await User.updateOne(
      { _id: studentUser._id },
      {
        $set: {
          mfaEnabled: true,
          mfaSecret: seal(secret, studentUser.id, config),
        },
      },
    );
    const challenge = await post(
      "/api/auth/login",
      { email: studentUser.email, password },
      "",
    );
    expect(challenge.body).toEqual({ mfaRequired: true });
    const cookie = (challenge.headers["set-cookie"] as unknown as string[])
      .find((value) => value.startsWith("softlans_mfa="))!
      .split(";")[0]!;
    // Also covers lost links without relying on the archive endpoint's session-version bump.
    await Student.deleteOne({ _id: student._id });
    const verified = await post(
      "/api/auth/mfa/verify",
      { code: totp(secret).generate() },
      cookie,
    );
    expect(verified.status).toBe(409);
    expect(verified.headers["set-cookie"]).toBeUndefined();
  });
  it("allows password changes through existing account security and revokes all old sessions", async () => {
    const response = await post(
      "/api/auth/change-password",
      { currentPassword: password, newPassword: "new-synthetic-password" },
      studentCookie,
    );
    expect(response.status).toBe(204);
    expect((await get("/api/student/profile")).status).toBe(401);
    expect(
      (
        await post(
          "/api/auth/login",
          { email: studentUser.email, password: "new-synthetic-password" },
          "",
        )
      ).status,
    ).toBe(200);
  });
});

describe("student schedule, attendance and finance", () => {
  it("projects eligible memberships, honors cancellation and snapshots without writes", async () => {
    const tomorrow = addDays(localDate(), 1);
    await Schedule.updateOne(
      { _id: schedule._id },
      { $set: { dayOfWeek: dayOfWeek(tomorrow) } },
    );
    const before = await LessonSession.countDocuments({});
    const projected = await get(`/api/student/schedule?date=${tomorrow}`);
    expect(projected.status).toBe(200);
    expect(projected.body.lessons).toHaveLength(1);
    expect(projected.body.lessons[0]).toMatchObject({
      date: tomorrow,
      startTime: "16:00",
      classroomName: "101-xona",
    });
    expect(await LessonSession.countDocuments({})).toBe(before);
    expect(
      (await get(`/api/student/schedule?date=${tomorrow}`, peerCookie)).body
        .lessons,
    ).toHaveLength(0);
    const snapshot = await lesson(tomorrow, { status: "cancelled" });
    const cancelled = await get(`/api/student/schedule?date=${tomorrow}`);
    expect(cancelled.body.lessons).toHaveLength(1);
    expect(cancelled.body.lessons[0]).toMatchObject({
      status: "cancelled",
      startTime: "10:00",
      groupName: snapshot.groupName,
    });
    expect((await get("/api/student/dashboard")).body.nextLesson).toBeNull();
    await LessonSession.updateOne(
      { _id: snapshot._id },
      { $set: { status: "scheduled" } },
    );
    expect(
      (await get("/api/student/dashboard")).body.nextLesson.startTime,
    ).toBe("10:00");
    await Membership.updateMany(
      { studentId: student._id },
      { $set: { status: "removed", removedAt: new Date("2020-01-02") } },
    );
    await Schedule.updateOne(
      { _id: schedule._id },
      { $set: { status: "inactive" } },
    );
    expect(
      (await get(`/api/student/schedule?date=${tomorrow}`)).body.lessons[0]
        .startTime,
    ).toBe("10:00");
  });
  it("does not project a recurrence when a persisted roster excludes this student", async () => {
    const tomorrow = addDays(localDate(), 1);
    await Schedule.updateOne(
      { _id: schedule._id },
      { $set: { dayOfWeek: dayOfWeek(tomorrow) } },
    );
    await lesson(tomorrow, { roster: [peer._id] });
    const result = await get(`/api/student/schedule?date=${tomorrow}`);
    expect(result.status).toBe(200);
    expect(result.body.lessons).toEqual([]);
    expect((await get("/api/student/dashboard")).body.nextLesson).toBeNull();
  });
  it("keeps pre-enrollment and removed membership recurrences out of the schedule", async () => {
    await Membership.updateMany(
      { studentId: student._id },
      { $set: { status: "removed", removedAt: new Date("2020-01-02") } },
    );
    expect(
      (await get(`/api/student/schedule?date=${localDate()}`)).body.lessons,
    ).toHaveLength(0);
    await Membership.deleteMany({ studentId: student._id });
    await Membership.create({
      tenantId: tenant,
      groupId: group._id,
      studentId: student._id,
      enrolledAt: new Date("2190-01-01"),
    });
    expect(
      (await get(`/api/student/schedule?date=${localDate()}`)).body.lessons,
    ).toHaveLength(0);
    for (const date of ["2025-02-30", "invalid"])
      expect((await get(`/api/student/schedule?date=${date}`)).status).toBe(
        400,
      );
  });
  it("counts marked and unmarked attendance only for the student and excludes cancelled lessons", async () => {
    const a = await lesson("2020-01-02"),
      b = await lesson("2020-01-03"),
      c = await lesson("2020-01-04");
    await lesson("2020-01-05", { status: "cancelled" });
    await AttendanceRecord.create([
      {
        tenantId: tenant,
        studentId: student._id,
        sessionId: a._id,
        status: "late",
        note: "INTERNAL_ATTENDANCE_NOTE",
        markedBy: teacherId,
        markedAt: new Date(),
      },
      {
        tenantId: tenant,
        studentId: student._id,
        sessionId: b._id,
        status: "absent",
        markedBy: teacherId,
        markedAt: new Date(),
      },
      {
        tenantId: tenant,
        studentId: peer._id,
        sessionId: c._id,
        status: "present",
        markedBy: teacherId,
        markedAt: new Date(),
      },
    ]);
    const result = await get("/api/student/attendance?month=2020-01");
    expect(result.body.summary).toMatchObject({
      late: 1,
      absent: 1,
      present: 0,
      marked: 2,
      unmarked: 1,
      attendancePercentage: 50,
    });
    expect(result.body.total).toBe(4);
    expect(
      result.body.lessons.find((l: { id: string }) => l.id === c.id).status,
    ).toBeNull();
    expect(JSON.stringify(result.body)).not.toMatch(
      /INTERNAL_ATTENDANCE_NOTE|roster|markedBy/,
    );
    expect(
      (await get("/api/student/attendance?month=2020-02")).body.summary
        .attendancePercentage,
    ).toBeNull();
    expect(
      (await get("/api/student/attendance?month=2020-02")).body.lessons,
    ).toEqual([]);
  });
  it("shows only own amounts and reversals with stable pagination and current cached balances", async () => {
    const own = await charge();
    await charge(peer._id);
    await charge(student._id, {
      billingMonth: "2019-12",
      cancelled: true,
      paidAmount: 0,
    });
    const paymentRows = await Payment.create(
      Array.from({ length: 21 }, (_, n) => ({
        tenantId: tenant,
        studentId: student._id,
        chargeId: own._id,
        amount: 1000,
        method: "cash",
        paidAt: new Date(
          `2020-01-${String(n + 1).padStart(2, "0")}T00:00:00+05:00`,
        ),
        recordedBy: ownerId,
        note: "PRIVATE_PAYMENT_NOTE",
        reference: "PRIVATE_REFERENCE",
        idempotencyKey: `synthetic-${n}`,
        fingerprint: "unused",
      })),
    );
    await PaymentReversal.create({
      tenantId: tenant,
      paymentId: paymentRows[20]!._id,
      recordedBy: ownerId,
      reason: "PRIVATE_REVERSAL_REASON",
    });
    const result = await get("/api/student/charges?month=2020-01");
    expect(result.body.total).toBe(1);
    expect(result.body.summary).toEqual({
      billed: 300000,
      paid: 100000,
      remaining: 200000,
    });
    expect(result.body.charges[0]).toMatchObject({
      status: "partial",
      remainingAmount: 200000,
    });
    const history = await get("/api/student/payments?month=2020-01");
    expect(history.body.total).toBe(21);
    expect(history.body.payments).toHaveLength(20);
    expect(history.body.payments[0].reversed).toBe(true);
    expect(JSON.stringify(history.body)).not.toMatch(
      /PRIVATE_|recordedBy|fingerprint|studentId|chargeId/,
    );
    const second = await get("/api/student/payments?month=2020-01&page=2");
    expect(second.body.payments).toHaveLength(1);
    expect(second.body.payments[0].id).not.toBe(history.body.payments[0].id);
    expect((await get("/api/student/dashboard")).body.outstandingAmount).toBe(
      200000,
    );
    expect(
      (await get("/api/student/charges?month=2020-01", peerCookie)).body.total,
    ).toBe(1);
    expect(
      (await get("/api/student/payments?month=2020-01", peerCookie)).body.total,
    ).toBe(0);
    for (const query of [
      "month=2020-13",
      "month[$ne]=x",
      "page=0",
      "page=1.5",
      "pageSize=1000",
      "tenantId=abc",
    ])
      expect((await get(`/api/student/payments?${query}`)).status).toBe(400);
    await Subscription.create({
      tenantId: tenant,
      planId: new mongoose.Types.ObjectId(),
      planName: "Sinov",
      planCode: "test",
      agreedPriceUZS: 100000,
      status: "expired",
      periodStart: new Date("2020-01-01"),
      periodEnd: new Date("2020-02-01"),
      studentLimit: 5,
      groupLimit: 5,
    });
    expect((await get("/api/student/dashboard")).status).toBe(200);
  });
});
