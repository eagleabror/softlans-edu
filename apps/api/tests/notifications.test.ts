import { beforeAll, afterAll, beforeEach, it, expect, vi } from "vitest";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { GrammyError } from "grammy";
import { createApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import { connectDatabase } from "../src/db.js";
import { ensureIndexes, Tenant, User, Student } from "../src/models.js";
import {
  GuardianLink,
  NotificationJob,
  NotificationSettings,
  AttendanceEvent,
} from "../src/notification-models.js";
import { TelegramDispatch, TelegramUpdate } from "../src/telegram-models.js";
import { Charge } from "../src/billing-models.js";
import { LessonSession } from "../src/attendance-models.js";
import { Group, Membership } from "../src/group-models.js";
import { Schedule } from "../src/schedule-models.js";
import { issueToken } from "../src/security.js";
import { hashToken } from "../src/telegram.js";
import {
  processNotification,
  enqueueNotification,
  planNotifications,
  quiet,
  debtEligible,
  attendanceEnabled,
  sourceEligible,
} from "../src/notifications.js";
import { localDate } from "../src/schedule-time.js";
const config = parseConfig({
  NODE_ENV: "test",
  APP_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "x".repeat(48),
  MONGODB_URI: "mongodb://localhost/test",
  TELEGRAM_BOT_TOKEN: "123:test",
  TELEGRAM_BOT_USERNAME: "softlans_test_bot",
  TELEGRAM_WEBHOOK_SECRET: "s".repeat(32),
});
const app = createApp(config),
  base = "/api/notifications";
let repl: MongoMemoryReplSet,
  tenantId: mongoose.Types.ObjectId,
  studentId: mongoose.Types.ObjectId,
  userId: mongoose.Types.ObjectId,
  cookie: string,
  seq = 0;
const oid = () => new mongoose.Types.ObjectId();
const post = (path: string, body: unknown = {}, auth = cookie) =>
  request(app)
    .post(base + path)
    .set("Cookie", auth)
    .set("Origin", config.APP_ORIGIN)
    .send(body);
const hook = (text: string, updateId = ++seq, tg = 12345) =>
  request(app)
    .post("/api/integrations/telegram/webhook")
    .set("X-Telegram-Bot-Api-Secret-Token", config.TELEGRAM_WEBHOOK_SECRET!)
    .send({
      update_id: updateId,
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        text,
        from: { id: tg, is_bot: false },
        chat: { id: tg, type: "private" },
      },
    });
const invite = () =>
  post("/invitations", {
    studentId: String(studentId),
    guardianName: "Guardian",
    telegramId: "12345",
    guardianshipConfirmed: true,
  });
async function connected() {
  return GuardianLink.create({
    tenantId,
    studentId,
    authorizedBy: userId,
    name: "Guardian",
    expectedTelegramId: "12345",
    chatId: "12345",
    enabled: true,
    verifiedAt: new Date(),
    consentAt: new Date(),
  });
}
async function settings(values = {}) {
  return NotificationSettings.create({
    tenantId,
    quietStart: "00:00",
    quietEnd: "00:00",
    ...values,
  });
}
async function permit() {
  await TelegramDispatch.deleteMany({});
}
beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: "7.0.24" },
  });
  await connectDatabase(repl.getUri("notifications"));
  await ensureIndexes();
});
afterAll(async () => {
  await mongoose.disconnect();
  await repl?.stop();
});
beforeEach(async () => {
  // Privileged fixture cleanup also clears append-only audit collections.
  for (const model of Object.values(mongoose.models))
    await model.collection.deleteMany({});
  tenantId = (await Tenant.create({ name: "Center" }))._id;
  const user = await User.create({
    tenantId,
    role: "business_owner",
    name: "Owner",
    email: "owner@example.com",
    passwordHash: "hash",
  });
  userId = user._id;
  cookie = `softlans_session=${issueToken(user, config)}`;
  studentId = (
    await Student.create({
      tenantId,
      createdBy: userId,
      firstName: "Student",
      lastName: "Test",
      enrollmentDate: new Date(),
      status: "active",
    })
  )._id;
});
it("requires owner guardianship attestation and stores only a single-use hash", async () => {
  const bad = await post("/invitations", {
    studentId: String(studentId),
    guardianName: "G",
    telegramId: "12345",
    guardianshipConfirmed: false,
  });
  expect(bad.status).toBe(400);
  const r = await invite();
  expect(r.status).toBe(201);
  const token = new URL(r.body.link).searchParams.get("start")!;
  const g = await GuardianLink.findById(r.body.guardianId).select("+tokenHash");
  expect(g?.tokenHash).toBe(hashToken(token));
  expect(g?.tokenExpiresAt!.getTime()! - Date.now()).toBeLessThanOrEqual(
    600000,
  );
  expect((await hook("/start " + token)).body.text).toContain("/consent");
  expect((await GuardianLink.findById(g!._id))?.enabled).toBe(false);
  expect((await hook("/start " + token)).body.text).toContain("yaroqsiz");
});
it("rejects expired and forwarded invitations", async () => {
  const r = await invite(),
    token = new URL(r.body.link).searchParams.get("start")!;
  expect((await hook("/start " + token, ++seq, 555)).body.text).toContain(
    "yaroqsiz",
  );
  await GuardianLink.updateOne(
    { _id: r.body.guardianId },
    { $set: { tokenExpiresAt: new Date(0) } },
  );
  expect((await hook("/start " + token)).body.text).toContain("yaroqsiz");
});
it("consent is explicit, account-bound, and webhook updates cannot replay", async () => {
  const r = await invite(),
    token = new URL(r.body.link).searchParams.get("start")!;
  await hook("/start " + token);
  await hook("/consent " + r.body.guardianId, ++seq, 555);
  expect((await GuardianLink.findById(r.body.guardianId))?.enabled).toBe(false);
  const updateId = ++seq;
  await hook("/consent " + r.body.guardianId, updateId);
  const revision = (await GuardianLink.findById(r.body.guardianId))!.revision;
  expect((await hook("/consent " + r.body.guardianId, updateId)).body).toEqual({
    ok: true,
  });
  expect((await GuardianLink.findById(r.body.guardianId))!.revision).toBe(
    revision,
  );
  await hook("/stop");
  expect((await GuardianLink.findById(r.body.guardianId))?.enabled).toBe(false);
  await hook("/disconnect");
  expect(
    (await GuardianLink.findById(r.body.guardianId))?.verifiedAt,
  ).toBeUndefined();
});
it("rejects tenant ID injection, cross-tenant students and RBAC violations", async () => {
  const foreign = await Student.create({
    tenantId: oid(),
    createdBy: userId,
    firstName: "Other",
    lastName: "Test",
    enrollmentDate: new Date(),
  });
  expect(
    (
      await post("/invitations", {
        studentId: String(foreign._id),
        guardianName: "G",
        telegramId: "12345",
        guardianshipConfirmed: true,
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await request(app)
        .get(base + "/guardians?studentId=" + foreign._id)
        .set("Cookie", cookie)
    ).status,
  ).toBe(404);
  expect(
    (
      await post("/invitations", {
        tenantId: String(tenantId),
        studentId: String(studentId),
        guardianName: "G",
        telegramId: "12345",
        guardianshipConfirmed: true,
      })
    ).status,
  ).toBe(400);
  for (const role of ["teacher", "super_admin", "admin"] as const) {
    const u = await User.create({
      ...(role === "super_admin" ? {} : { tenantId }),
      role,
      name: role,
      email: role + "@example.com",
      passwordHash: "hash",
    });
    const auth = `softlans_session=${issueToken(u, config)}`;
    expect((await post("/invitations", {}, auth)).status).toBe(403);
    expect((await post("/test", {}, auth)).status).toBe(403);
  }
});
it("supports multiple verified guardians; staff cannot grant consent", async () => {
  const a = await connected(),
    b = await GuardianLink.create({
      tenantId,
      studentId,
      authorizedBy: userId,
      name: "Second guardian",
      expectedTelegramId: "54321",
      chatId: "54321",
      verifiedAt: new Date(),
      consentAt: new Date(),
      enabled: true,
    });
  expect(a._id.equals(b._id)).toBe(false);
  expect(
    (
      await request(app)
        .patch(`${base}/guardians/${a._id}/preferences`)
        .set("Cookie", cookie)
        .set("Origin", config.APP_ORIGIN)
        .send({ enabled: true })
    ).status,
  ).toBe(400);
});
it("idempotency and concurrent workers send once", async () => {
  await settings();
  const g = await connected();
  await Promise.all([
    enqueueNotification(g, { kind: "test", key: "test" }),
    enqueueNotification(g, { kind: "test", key: "test" }),
  ]);
  expect(await NotificationJob.countDocuments()).toBe(1);
  const send = vi.fn().mockResolvedValue({});
  await Promise.all([
    processNotification(config, send),
    processNotification(config, send),
  ]);
  expect(send).toHaveBeenCalledTimes(1);
  expect((await NotificationJob.findOne())?.status).toBe("sent");
});
it("rechecks opt-out and revision immediately before send", async () => {
  await settings();
  const g = await connected();
  await enqueueNotification(g, { kind: "test", key: "test" });
  await GuardianLink.updateOne(
    { _id: g._id },
    { $set: { enabled: false }, $inc: { revision: 1 } },
  );
  const send = vi.fn();
  await processNotification(config, send);
  expect(send).not.toHaveBeenCalled();
  expect((await NotificationJob.findOne())?.status).toBe("cancelled");
});
it("expired leases have unknown outcomes and cannot be manually retried", async () => {
  await settings();
  const g = await connected();
  const j = await enqueueNotification(g, { kind: "test", key: "test" });
  await NotificationJob.updateOne(
    { _id: j!._id },
    { $set: { status: "sending", leaseId: "old", leaseUntil: new Date(0) } },
  );
  const send = vi.fn();
  await processNotification(config, send);
  expect(send).not.toHaveBeenCalled();
  expect((await NotificationJob.findById(j!._id))?.errorCode).toBe(
    "UNKNOWN_OUTCOME",
  );
  expect((await post(`/jobs/${j!._id}/retry`)).status).toBe(409);
});
it("honors 429 retry_after and bounds retries to five attempts", async () => {
  await settings();
  const g = await connected();
  await enqueueNotification(g, { kind: "test", key: "test" });
  const send = vi.fn().mockRejectedValue(
    new GrammyError(
      "rate",
      {
        ok: false,
        error_code: 429,
        description: "rate",
        parameters: { retry_after: 120 },
      },
      "sendMessage",
      {},
    ),
  );
  await processNotification(config, send);
  let j = (await NotificationJob.findOne())!;
  expect(j.status).toBe("pending");
  expect(j.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 115000);
  await permit();
  await NotificationJob.updateOne(
    { _id: j._id },
    { $set: { attempts: 4, nextAttemptAt: new Date(0) } },
  );
  await processNotification(config, send);
  j = (await NotificationJob.findOne())!;
  expect(j.status).toBe("failed");
  expect(j.attempts).toBe(5);
  expect((await post(`/jobs/${j._id}/retry`)).status).toBe(409);
});
it.each([400, 403])(
  "disables blocked/invalid recipients (%s)",
  async (code) => {
    await settings();
    const g = await connected();
    await enqueueNotification(g, { kind: "test", key: "test" });
    await processNotification(
      config,
      vi
        .fn()
        .mockRejectedValue(
          new GrammyError(
            "bad",
            { ok: false, error_code: code, description: "bad" },
            "sendMessage",
            {},
          ),
        ),
    );
    expect((await GuardianLink.findById(g._id))?.enabled).toBe(false);
    expect((await NotificationJob.findOne())?.status).toBe("failed");
  },
);
it("network failures remain unknown and are not automatically retried", async () => {
  await settings();
  const g = await connected();
  await enqueueNotification(g, { kind: "test", key: "test" });
  await processNotification(
    config,
    vi.fn().mockRejectedValue(new Error("private error")),
  );
  const j = (await NotificationJob.findOne())!;
  expect(j.errorCode).toBe("UNKNOWN_OUTCOME");
  expect(JSON.stringify(j)).not.toContain("private error");
});
it("debt reminders suppress fully paid/cancelled charges and honor reversals", async () => {
  await settings({ debt: true, debtDays: [0] });
  const g = await connected();
  const c = await Charge.create({
    tenantId,
    studentId,
    generatedBy: userId,
    groupId: oid(),
    billingMonth: "2026-10",
    originalAmount: 100,
    finalAmount: 100,
    paidAmount: 100,
    dueDate: new Date(),
  });
  await planNotifications();
  expect(await NotificationJob.countDocuments()).toBe(0);
  // Billing writes reconcile paidAmount transactionally on payment reversal.
  c.paidAmount = 0;
  await c.save();
  await planNotifications();
  expect(await NotificationJob.countDocuments()).toBe(1);
  const j = (await NotificationJob.findOne())!,
    s = (await NotificationSettings.findOne())!;
  expect(await sourceEligible(j, s, new Date())).toBe(true);
  c.paidAmount = 100;
  await c.save();
  expect(await sourceEligible(j, s, new Date())).toBe(false);
  c.paidAmount = 0;
  c.cancelled = true;
  await c.save();
  expect(await sourceEligible(j, s, new Date())).toBe(false);
  expect(g.enabled).toBe(true);
});
it("attendance alerts and corrections only use committed explicit events", async () => {
  const s = await settings({ attendance: true, corrections: true });
  const g = await connected();
  const session = await LessonSession.create({
    tenantId,
    groupId: oid(),
    scheduleId: oid(),
    teacherId: userId,
    lessonDate: localDate(),
    startTime: "10:00",
    endTime: "11:00",
    groupName: "Group",
    roster: [studentId],
  });
  await planNotifications();
  expect(await NotificationJob.countDocuments()).toBe(0);
  const tx = await mongoose.startSession();
  tx.startTransaction();
  await AttendanceEvent.create(
    [
      {
        tenantId,
        studentId,
        sessionId: session._id,
        revision: 1,
        status: "absent",
        correction: false,
      },
    ],
    { session: tx },
  );
  await planNotifications();
  expect(await NotificationJob.countDocuments()).toBe(0);
  await tx.commitTransaction();
  await tx.endSession();
  await planNotifications();
  const j = (await NotificationJob.findOne())!;
  expect(await sourceEligible(j, s, new Date())).toBe(true);
  const e = await AttendanceEvent.create({
    tenantId,
    studentId,
    sessionId: session._id,
    revision: 2,
    status: "present",
    correction: true,
  });
  expect(await sourceEligible(j, s, new Date())).toBe(false);
  await planNotifications();
  expect(await NotificationJob.countDocuments()).toBe(2);
  const correction = (await NotificationJob.findOne({ sourceId: e._id }))!;
  expect(await sourceEligible(correction, s, new Date())).toBe(true);
  session.status = "cancelled";
  await session.save();
  expect(await sourceEligible(correction, s, new Date())).toBe(false);
  expect(g.enabled).toBe(true);
});
it("lesson reminders recheck enrollment, rescheduling and cancellations", async () => {
  const s = await settings({ lesson: true }),
    g = await connected();
  const group = await Group.create({
    tenantId,
    name: "Group",
    courseName: "Course",
    teacherId: userId,
    capacity: 10,
    monthlyFee: 100,
    startDate: new Date(0),
  });
  await Membership.create({
    tenantId,
    studentId,
    groupId: group._id,
    enrolledAt: new Date(0),
  });
  const now = new Date("2026-10-30T04:00:00Z");
  const schedule = await Schedule.create({
    tenantId,
    groupId: group._id,
    teacherId: userId,
    classroomId: oid(),
    dayOfWeek: 5,
    startTime: "10:00",
    endTime: "11:00",
  });
  const j = await enqueueNotification(g, {
    kind: "lesson",
    key: "lesson",
    sourceId: schedule._id,
    eventDate: "2026-10-30",
    timing: 1,
    version: schedule.updatedAt.toISOString(),
  });
  expect(await sourceEligible(j!, s, now)).toBe(true);
  const session = await LessonSession.create({
    tenantId,
    groupId: group._id,
    scheduleId: schedule._id,
    teacherId: userId,
    lessonDate: "2026-10-30",
    startTime: "10:00",
    endTime: "11:00",
    groupName: "Group",
    roster: [studentId],
    status: "cancelled",
  });
  expect(await sourceEligible(j!, s, now)).toBe(false);
  await session.deleteOne();
  await Membership.updateMany({}, { $set: { status: "removed" } });
  expect(await sourceEligible(j!, s, now)).toBe(false);
  await Membership.updateMany({}, { $set: { status: "active" } });
  schedule.startTime = "10:30";
  await schedule.save();
  expect(await sourceEligible(j!, s, now)).toBe(false);
});
it("quiet hours defer without spending an attempt", async () => {
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tashkent",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  await settings({
    quietStart: clock.format(new Date(Date.now() - 60000)),
    quietEnd: clock.format(new Date(Date.now() + 3600000)),
  });
  const g = await connected();
  await enqueueNotification(g, { kind: "test", key: "quiet" });
  const send = vi.fn();
  await processNotification(config, send);
  const j = (await NotificationJob.findOne())!;
  expect(send).not.toHaveBeenCalled();
  expect(j.attempts).toBe(0);
  expect(j.status).toBe("pending");
});
it("Tashkent date boundaries, midnight quiet hours and status policy", () => {
  expect(localDate(new Date("2026-10-30T19:00:00Z"))).toBe("2026-10-31");
  expect(localDate(new Date("2026-10-30T18:59:59Z"))).toBe("2026-10-30");
  expect(quiet(new Date("2026-10-30T16:00:00Z"), "21:00", "08:00")).toBe(true);
  expect(quiet(new Date("2026-10-31T03:00:00Z"), "21:00", "08:00")).toBe(false);
  expect(quiet(new Date(), "00:00", "00:00")).toBe(false);
  expect(
    debtEligible({ cancelled: false, finalAmount: 1, paidAmount: 1 }),
  ).toBe(false);
  expect(
    attendanceEnabled(
      { attendance: true, late: false, excused: false, corrections: false },
      "present",
      false,
    ),
  ).toBe(false);
});

it("reissuing a pending invitation rotates the hash without duplicate guardians", async () => {
  const a = await invite(),
    b = await invite();
  expect(a.body.guardianId).toBe(b.body.guardianId);
  expect(await GuardianLink.countDocuments()).toBe(1);
  expect(
    (await hook("/start " + new URL(a.body.link).searchParams.get("start")))
      .body.text,
  ).toContain("yaroqsiz");
  await hook("/start " + new URL(b.body.link).searchParams.get("start"));
  expect((await invite()).status).toBe(409);
});
it("authorized retry preserves attempt budget and tenant boundaries", async () => {
  const g = await connected();
  const j = await enqueueNotification(g, { kind: "test", key: "retry" });
  await NotificationJob.updateOne(
    { _id: j!._id },
    { $set: { status: "failed", errorCode: "TELEGRAM_503", attempts: 2 } },
  );
  expect((await post(`/jobs/${j!._id}/retry`)).status).toBe(202);
  expect((await NotificationJob.findById(j!._id))?.attempts).toBe(2);
  expect((await post(`/jobs/${oid()}/retry`)).status).toBe(409);
});
it("failure before an external send requeues safely with a bounded budget", async () => {
  await settings();
  const g = await connected();
  await enqueueNotification(g, { kind: "test", key: "check" });
  const spy = vi
    .spyOn(Tenant, "exists")
    .mockRejectedValueOnce(new Error("database unavailable"));
  const send = vi.fn();
  await expect(processNotification(config, send)).rejects.toThrow();
  spy.mockRestore();
  const j = (await NotificationJob.findOne())!;
  expect(j.status).toBe("pending");
  expect(j.errorCode).toBe("CHECK_FAILED");
  expect(j.attempts).toBe(1);
  expect(send).not.toHaveBeenCalled();
});

async function diagnosticSession() {
  return LessonSession.create({
    tenantId,
    groupId: oid(),
    scheduleId: oid(),
    teacherId: userId,
    lessonDate: localDate(),
    startTime: "10:00",
    endTime: "11:00",
    groupName: "Synthetic",
    roster: [studentId],
  });
}
const diagnostics = (sessionId?: string, auth = cookie) =>
  request(app)
    .get(
      base +
        "/diagnostics" +
        (sessionId ? `?studentId=${studentId}&sessionId=${sessionId}` : ""),
    )
    .set("Cookie", auth);
it("traces real attendance API -> committed event -> planner -> consenting guardian -> delivery", async () => {
  await settings({ attendance: true, corrections: false });
  await connected();
  const session = await diagnosticSession();
  const path = `/api/attendance/sessions/${session._id}/attendance`;
  const save = (status: string, revision: number) =>
    request(app)
      .patch(path)
      .set("Cookie", cookie)
      .set("Origin", config.APP_ORIGIN)
      .send({ revision, records: [{ studentId: String(studentId), status }] });
  expect((await save("present", 0)).status).toBe(200);
  await planNotifications();
  expect(await NotificationJob.countDocuments()).toBe(0);
  expect((await save("absent", 1)).status).toBe(200);
  expect(
    (await AttendanceEvent.findOne({ status: "absent" }))?.correction,
  ).toBe(true);
  expect((await diagnostics(String(session._id))).body.attendance.reason).toBe(
    "WAITING_FOR_PLANNER",
  );
  await planNotifications();
  expect(await NotificationJob.countDocuments()).toBe(1);
  expect((await diagnostics(String(session._id))).body.attendance.reason).toBe(
    "DELIVERY_PENDING",
  );
  const send = vi.fn().mockResolvedValue({});
  await processNotification(config, send);
  expect(send).toHaveBeenCalledTimes(1);
  expect((await diagnostics(String(session._id))).body.attendance.reason).toBe(
    "DELIVERED",
  );
  expect((await save("absent", 2)).status).toBe(200);
  await planNotifications();
  await permit();
  await processNotification(config, send);
  expect(send).toHaveBeenCalledTimes(1);
  expect((await save("present", 3)).status).toBe(200);
  await planNotifications();
  expect(await NotificationJob.countDocuments()).toBe(1); // Correction-only notices still disabled.
});
it("diagnostics distinguish missing settings, verification, consent and recipient opt-out", async () => {
  const session = await diagnosticSession();
  await AttendanceEvent.create({
    tenantId,
    studentId,
    sessionId: session._id,
    revision: 1,
    status: "absent",
  });
  const reason = async () =>
    (await diagnostics(String(session._id))).body.attendance.reason;
  expect(await reason()).toBe("TENANT_ATTENDANCE_DISABLED");
  await settings({ attendance: true });
  expect(await reason()).toBe("NO_VERIFIED_GUARDIAN");
  const g = await connected();
  await GuardianLink.updateOne(
    { _id: g._id },
    { $set: { enabled: false }, $unset: { consentAt: 1 } },
  );
  expect(await reason()).toBe("NO_GUARDIAN_CONSENT");
  await GuardianLink.updateOne(
    { _id: g._id },
    { $set: { enabled: true, consentAt: new Date(), attendance: false } },
  );
  expect(await reason()).toBe("RECIPIENT_ATTENDANCE_DISABLED");
});
it("diagnostics are owner-only, tenant scoped, validated and contain no recipient data", async () => {
  const session = await diagnosticSession();
  await connected();
  const response = await diagnostics(String(session._id));
  expect(response.status).toBe(200);
  for (const field of [
    String(studentId),
    String(tenantId),
    String(session._id),
    '"Guardian"',
    "12345",
    config.TELEGRAM_BOT_TOKEN!,
    config.JWT_SECRET,
  ])
    expect(response.text).not.toContain(field);
  const original = studentId;
  studentId = oid();
  expect((await diagnostics(String(session._id))).status).toBe(404);
  studentId = original;
  expect(
    (
      await request(app)
        .get(base + "/diagnostics?tenantId=" + tenantId)
        .set("Cookie", cookie)
    ).status,
  ).toBe(400);
  for (const role of ["admin", "teacher", "super_admin"] as const) {
    const u = await User.create({
      ...(role === "super_admin" ? {} : { tenantId }),
      role,
      name: role,
      email: `${role}@example.test`,
      passwordHash: "hash",
    });
    expect(
      (
        await diagnostics(
          undefined,
          `softlans_session=${issueToken(u, config)}`,
        )
      ).status,
    ).toBe(403);
  }
});
it("scheduler diagnostics report never-seen, recent and stale runs without global counts", async () => {
  const { NotificationProcessorState } =
    await import("../src/notification-models.js");
  expect((await diagnostics()).body.processor.state).toBe("never_seen");
  await NotificationProcessorState.create({
    _id: "automation",
    stage: "completed",
    lastHeartbeatAt: new Date(),
    lastCompletedAt: new Date(),
  });
  expect((await diagnostics()).body.processor.state).toBe("recent");
  await NotificationProcessorState.updateOne(
    {},
    { $set: { lastHeartbeatAt: new Date(0) } },
  );
  expect((await diagnostics()).body.processor.state).toBe("stale");
});
it("one planner failure cannot prevent guardian delivery, and logs are safe", async () => {
  const { runNotificationAutomation } =
    await import("../src/notification-automation.js");
  const guardians = vi.fn().mockResolvedValue(undefined),
    owners = vi.fn().mockRejectedValue(new Error("private student bot-secret")),
    process = vi.fn().mockResolvedValue(false),
    log = vi.fn();
  expect(
    await runNotificationAutomation(config, {
      guardians,
      owners,
      process,
      log,
    }),
  ).toBe(false);
  expect(guardians).toHaveBeenCalledOnce();
  expect(process).toHaveBeenCalledOnce();
  expect(JSON.stringify(log.mock.calls)).not.toContain(
    "private student bot-secret",
  );
  expect((await diagnostics()).body.processor.stage).toBe("failed");
});
it("processor records completion and rejects missing bot configuration visibly", async () => {
  const { runNotificationAutomation } =
    await import("../src/notification-automation.js");
  const overrides = {
    guardians: vi.fn().mockResolvedValue(undefined),
    owners: vi.fn().mockResolvedValue(undefined),
    process: vi.fn().mockResolvedValue(false),
    log: vi.fn(),
  };
  expect(await runNotificationAutomation(config, overrides)).toBe(true);
  expect((await diagnostics()).body.processor.lastCompletedAt).toBeTruthy();
  expect(
    await runNotificationAutomation(
      { ...config, TELEGRAM_BOT_TOKEN: undefined },
      overrides,
    ),
  ).toBe(false);
  expect(overrides.log).toHaveBeenCalledWith(
    expect.objectContaining({ code: "TELEGRAM_NOT_CONFIGURED" }),
  );
});
it("absence and enabled late/excused alerts survive edits while correction-only notices remain configurable", () => {
  const s = { attendance: true, corrections: false, late: true, excused: true };
  for (const status of ["absent", "late", "excused"])
    expect(attendanceEnabled(s, status, true)).toBe(true);
  expect(attendanceEnabled(s, "present", true)).toBe(false);
  expect(attendanceEnabled({ ...s, attendance: false }, "absent", true)).toBe(
    false,
  );
});
it("expires an old guardian test without a send attempt instead of forcing stale delivery", async () => {
  await settings();
  const g = await connected();
  const job = await enqueueNotification(g, { kind: "test", key: "stale-test" });
  await NotificationJob.collection.updateOne(
    { _id: job!._id },
    { $set: { createdAt: new Date(Date.now() - 3600001) } },
  );
  const send = vi.fn();
  await processNotification(config, send);
  const row = await NotificationJob.findById(job!._id);
  expect(send).not.toHaveBeenCalled();
  expect(row?.status).toBe("cancelled");
  expect(row?.attempts).toBe(0);
  expect(row?.errorCode).toBe("INELIGIBLE");
});
