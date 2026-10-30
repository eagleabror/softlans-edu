import { beforeAll, afterAll, beforeEach, it, expect, vi } from "vitest";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { GrammyError } from "grammy";
import { createApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import { connectDatabase } from "../src/db.js";
import { ensureIndexes, Tenant, User, Student } from "../src/models.js";
import { Charge, Payment, PaymentReversal } from "../src/billing-models.js";
import {
  Payroll,
  SalaryPayout,
  SalaryPayoutReversal,
} from "../src/payroll-models.js";
import { LessonSession, AttendanceRecord } from "../src/attendance-models.js";
import {
  TelegramIntegration,
  TelegramDispatch,
} from "../src/telegram-models.js";
import { DailyReportSettings } from "../src/daily-report-models.js";
import {
  NotificationJob,
  NotificationSettings,
} from "../src/notification-models.js";
import {
  reportPeriod,
  generateDailyReport,
  formatDailyReport,
  planDailyReports,
  enqueueDailyReport,
  dailySettingsInput,
} from "../src/daily-reports.js";
import { processNotification } from "../src/notifications.js";
import { issueToken } from "../src/security.js";
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
  oid = () => new mongoose.Types.ObjectId();
let repl: MongoMemoryReplSet,
  tenantId: mongoose.Types.ObjectId,
  userId: mongoose.Types.ObjectId,
  cookie: string;
const now = () => new Date();
const get = (path: string, auth = cookie) =>
  request(app).get(`/api/daily-reports${path}`).set("Cookie", auth);
const post = () =>
  request(app)
    .post("/api/daily-reports/test")
    .set("Cookie", cookie)
    .set("Origin", config.APP_ORIGIN)
    .send({});
async function settings(extra = {}) {
  return DailyReportSettings.create({
    tenantId,
    userId,
    enabled: true,
    time: "00:00",
    quietStart: "00:00",
    quietEnd: "00:00",
    ...extra,
  });
}
async function link() {
  return TelegramIntegration.create({
    tenantId,
    userId,
    status: "connected",
    chatId: "private-secret",
    telegramUserId: "123",
    notificationPreferences: { enabled: true },
  });
}
async function ready() {
  const s = await settings();
  await link();
  return (await enqueueDailyReport(s))!;
}
async function permit() {
  await TelegramDispatch.deleteMany({});
}
beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: "7.0.24" },
  });
  await connectDatabase(repl.getUri("daily"));
  await ensureIndexes();
});
afterAll(async () => {
  await mongoose.disconnect();
  await repl?.stop();
});
beforeEach(async () => {
  for (const m of Object.values(mongoose.models)) await m.deleteMany({});
  tenantId = (await Tenant.create({ name: "Center" }))._id;
  const user = await User.create({
    tenantId,
    role: "business_owner",
    name: "Owner",
    email: "owner@test.uz",
    passwordHash: "hash",
  });
  userId = user._id;
  cookie = `softlans_session=${issueToken(user, config)}`;
});
it("defines half-open Tashkent day across UTC midnight", () => {
  expect(reportPeriod(new Date("2026-10-29T19:00:00Z")).date).toBe(
    "2026-10-30",
  );
  const p = reportPeriod(new Date("2026-10-30T18:59:59Z"));
  expect(p.start.toISOString()).toBe("2026-10-29T19:00:00.000Z");
  expect(p.end.toISOString()).toBe("2026-10-30T19:00:00.000Z");
});
it("handles empty data, unavailable rates and selective privacy-safe text", async () => {
  const r = await generateDailyReport(tenantId);
  expect(r.financial.received).toBe(0);
  expect(r.attendance.attendancePercentage).toBeNull();
  const text = formatDailyReport(r, ["students"]);
  expect(text).not.toContain("tushum");
  expect(text).not.toContain(String(tenantId));
  expect(
    dailySettingsInput.safeParse({ enabled: true, time: "25:00" }).success,
  ).toBe(false);
});
it("counts student documents once and treats unknown legacy archive dates as unavailable", async () => {
  await Student.create({
    tenantId,
    createdBy: userId,
    firstName: "Private",
    lastName: "Name",
    enrollmentDate: "2026-10-30",
  });
  await Student.create({
    tenantId: oid(),
    createdBy: userId,
    firstName: "Other",
    lastName: "Tenant",
    enrollmentDate: "2026-10-30",
  });
  await Student.create({
    tenantId,
    createdBy: userId,
    firstName: "Old",
    lastName: "Archive",
    enrollmentDate: "2020-01-01",
    status: "archived",
  });
  const r = await generateDailyReport(
    tenantId,
    new Date("2026-10-30T15:00:00Z"),
  );
  expect(r.students).toEqual({ active: 1, enrolled: 1, archived: null });
  expect(formatDailyReport(r, ["students"])).not.toContain("Private");
});
it("uses valid daily transaction dates and ledger debt, excluding reversals and cancelled charges", async () => {
  const studentId = oid(),
    groupId = oid();
  const c = await Charge.create({
    tenantId,
    generatedBy: userId,
    studentId,
    groupId,
    billingMonth: "2026-09",
    originalAmount: 1000,
    finalAmount: 1000,
    dueDate: "2026-10-28",
  });
  const pay = async (amount: number, paidAt: string) =>
    Payment.create({
      tenantId,
      studentId,
      chargeId: c._id,
      amount,
      method: "cash",
      paidAt,
      recordedBy: userId,
      idempotencyKey: String(oid()),
      fingerprint: "f",
    });
  await pay(100, "2026-10-29T18:59:59Z");
  await pay(200, "2026-10-29T19:00:00Z");
  const reversed = await pay(300, "2026-10-30T12:00:00Z");
  await PaymentReversal.create({
    tenantId,
    paymentId: reversed._id,
    recordedBy: userId,
    reason: "test",
  });
  await pay(50, "2026-10-30T19:00:00Z");
  const r = await generateDailyReport(
    tenantId,
    new Date("2026-10-30T15:00:00Z"),
  );
  expect(r.financial).toMatchObject({
    received: 200,
    transactions: 1,
    outstanding: 700,
    overdue: 700,
  });
  await Charge.updateOne({ _id: c._id }, { cancelled: true });
  expect(
    (await generateDailyReport(tenantId, new Date("2026-10-30T15:00:00Z")))
      .financial,
  ).toMatchObject({ received: 0, outstanding: 0 });
});
it("includes incomplete attendance and clearly defines both denominators", async () => {
  const roster = [oid(), oid(), oid(), oid()];
  const lesson = await LessonSession.create({
    tenantId,
    groupId: oid(),
    scheduleId: oid(),
    teacherId: userId,
    groupName: "Private",
    lessonDate: "2026-10-30",
    startTime: "10:00",
    endTime: "11:00",
    roster,
  });
  for (const [i, status] of ["present", "late", "absent"].entries())
    await AttendanceRecord.create({
      tenantId,
      sessionId: lesson._id,
      studentId: roster[i],
      status,
      markedBy: userId,
      markedAt: now(),
    });
  const r = await generateDailyReport(
    tenantId,
    new Date("2026-10-30T15:00:00Z"),
  );
  expect(r.attendance).toMatchObject({
    scheduled: 1,
    completed: 0,
    marked: 3,
    unmarked: 1,
    attendancePercentage: 66.67,
    coveragePercentage: 75,
  });
});
it("reports monthly approved payroll and current liabilities from unreversed payouts", async () => {
  const p = await Payroll.create({
    tenantId,
    teacherId: userId,
    payrollMonth: "2026-10",
    calculationBasis: {},
    grossSalary: 1000,
    finalSalary: 1000,
    status: "approved",
    calculatedAt: now(),
    createdBy: userId,
  });
  const payout = await SalaryPayout.create({
    tenantId,
    payrollId: p._id,
    recordedBy: userId,
    amount: 250,
    paidAt: "2026-10-30T10:00:00Z",
    method: "cash",
    idempotencyKey: "test",
    fingerprint: "f",
  });
  let r = await generateDailyReport(tenantId, new Date("2026-10-30T15:00:00Z"));
  expect(r.payroll).toEqual({
    approvedMonthly: 1000,
    paidToday: 250,
    outstanding: 750,
  });
  await SalaryPayoutReversal.create({
    tenantId,
    payoutId: payout._id,
    recordedBy: userId,
    reason: "test",
  });
  r = await generateDailyReport(tenantId, new Date("2026-10-30T15:00:00Z"));
  expect(r.payroll.outstanding).toBe(1000);
});
it("deduplicates concurrent scheduler runs and atomically sends once with concurrent workers", async () => {
  await settings();
  await link();
  await Promise.all([planDailyReports(), planDailyReports()]);
  expect(await NotificationJob.countDocuments({})).toBe(1);
  const send = vi.fn().mockResolvedValue({});
  await permit();
  await Promise.all([
    processNotification(config, send),
    processNotification(config, send),
  ]);
  expect(send).toHaveBeenCalledTimes(1);
  expect((await NotificationJob.findOne())?.status).toBe("sent");
});
it.each(["disconnect", "optout", "tenant", "role", "settings"])(
  "revalidates %s immediately before delivery",
  async (change) => {
    await ready();
    if (change === "disconnect")
      await TelegramIntegration.updateMany({}, { status: "disconnected" });
    if (change === "optout")
      await TelegramIntegration.updateMany(
        {},
        { "notificationPreferences.enabled": false },
      );
    if (change === "tenant")
      await Tenant.updateOne({ _id: tenantId }, { active: false });
    if (change === "role")
      await User.updateOne({ _id: userId }, { role: "admin" });
    if (change === "settings")
      await DailyReportSettings.updateMany({}, { enabled: false });
    const send = vi.fn();
    await permit();
    await processNotification(config, send);
    expect(send).not.toHaveBeenCalled();
    expect((await NotificationJob.findOne())?.status).toBe("cancelled");
  },
);
it("respects owner and tenant quiet hours without consuming send attempts", async () => {
  await ready();
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tashkent",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(now());
  await NotificationSettings.create({
    tenantId,
    quietStart: `${clock}:00`,
    quietEnd: `${String((Number(clock) + 1) % 24).padStart(2, "0")}:00`,
  });
  const send = vi.fn();
  await permit();
  await processNotification(config, send);
  expect(send).not.toHaveBeenCalled();
  expect((await NotificationJob.findOne())?.attempts).toBe(0);
});
it.each([429, 500, 403])(
  "handles Telegram %s through existing retry policy",
  async (code) => {
    await ready();
    await permit();
    await processNotification(
      config,
      vi.fn().mockRejectedValue(
        new GrammyError(
          "test",
          {
            ok: false,
            error_code: code,
            description: "test",
            parameters: { retry_after: 60 },
          },
          "sendMessage",
          {},
        ),
      ),
    );
    expect((await NotificationJob.findOne())?.status).toBe(
      code === 403 ? "failed" : "pending",
    );
  },
);
it("does not retry uncertain delivery after transport errors or expired leases", async () => {
  await ready();
  await permit();
  await processNotification(
    config,
    vi.fn().mockRejectedValue(new Error("network")),
  );
  expect((await NotificationJob.findOne())?.errorCode).toBe("UNKNOWN_OUTCOME");
  await NotificationJob.updateMany(
    {},
    { status: "sending", leaseUntil: new Date(0) },
  );
  await permit();
  const send = vi.fn();
  await processNotification(config, send);
  expect(send).not.toHaveBeenCalled();
  expect((await NotificationJob.findOne())?.status).toBe("failed");
});
it.each(["admin", "teacher", "super_admin"])(
  "denies %s all report APIs",
  async (role) => {
    const user = await User.create({
      tenantId: role === "super_admin" ? null : tenantId,
      name: role,
      email: `${role}@test.uz`,
      role,
      passwordHash: "hash",
    });
    const auth = `softlans_session=${issueToken(user, config)}`;
    for (const path of [
      "/settings",
      "/preview",
      "/history",
      `/history/${oid()}`,
    ])
      expect((await get(path, auth)).status).toBe(403);
  },
);
it("isolates owners, redacts secrets, excludes reports from guardian history and bounds tests", async () => {
  await ready();
  const job = (await NotificationJob.findOne())!;
  const response = await get("/settings");
  expect(response.status).toBe(200);
  expect(JSON.stringify(response.body)).not.toContain("private-secret");
  expect((await post()).status).toBe(202);
  expect((await post()).status).toBe(202);
  expect(await NotificationJob.countDocuments({ kind: "owner_test" })).toBe(1);
  const guardianHistory = await request(app)
    .get("/api/notifications/history")
    .set("Cookie", cookie);
  expect(guardianHistory.body.total).toBe(0);
  const otherTenant = (await Tenant.create({ name: "Other" }))._id;
  const other = await User.create({
    tenantId: otherTenant,
    role: "business_owner",
    name: "Other",
    email: "other@test.uz",
    passwordHash: "hash",
  });
  expect(
    (
      await get(
        `/history/${job._id}`,
        `softlans_session=${issueToken(other, config)}`,
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await request(app)
        .patch("/api/daily-reports/settings")
        .set("Cookie", cookie)
        .send({})
    ).status,
  ).toBe(403);
});

it("counts default enrollment instants at Tashkent midnight correctly", async () => {
  await Student.create({
    tenantId,
    createdBy: userId,
    firstName: "New",
    lastName: "Student",
    enrollmentDate: "2026-10-29T19:00:00Z",
  });
  const r = await generateDailyReport(
    tenantId,
    new Date("2026-10-30T15:00:00Z"),
  );
  expect(r.students.enrolled).toBe(1);
});
it("plans only enabled due owners, with separate jobs for owners in one tenant", async () => {
  await settings({ enabled: false });
  await link();
  await planDailyReports();
  expect(await NotificationJob.countDocuments({})).toBe(0);
  await DailyReportSettings.updateMany({}, { enabled: true, time: "23:59" });
  await planDailyReports(new Date("2026-10-30T10:00:00Z"));
  expect(await NotificationJob.countDocuments({})).toBe(0);
  await DailyReportSettings.updateMany({}, { time: "00:00" });
  const second = await User.create({
    tenantId,
    name: "Second",
    email: "second@test.uz",
    role: "business_owner",
    passwordHash: "hash",
  });
  await DailyReportSettings.create({
    tenantId,
    userId: second._id,
    enabled: true,
    time: "00:00",
  });
  await TelegramIntegration.create({
    tenantId,
    userId: second._id,
    status: "connected",
    chatId: "second",
    telegramUserId: "second",
    notificationPreferences: { enabled: true },
  });
  await planDailyReports();
  expect(await NotificationJob.countDocuments({ kind: "owner_daily" })).toBe(2);
});
it("invalidates queued reports when settings revision changes", async () => {
  await ready();
  await DailyReportSettings.updateMany({}, { $inc: { revision: 1 } });
  const send = vi.fn();
  await permit();
  await processNotification(config, send);
  expect(send).not.toHaveBeenCalled();
  expect((await NotificationJob.findOne())?.status).toBe("cancelled");
});
