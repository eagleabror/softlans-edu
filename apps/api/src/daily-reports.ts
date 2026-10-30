import { safeTotal } from "./payroll-calculation.js";
import mongoose, { type Types } from "mongoose";
import { z } from "zod";
import { Student, Tenant, User } from "./models.js";
import { Charge, Payment } from "./billing-models.js";
import {
  Payroll,
  SalaryPayout,
  SalaryPayoutReversal,
} from "./payroll-models.js";
import { LessonSession, AttendanceRecord } from "./attendance-models.js";
import { Schedule } from "./schedule-models.js";
import { materializeSchedule, attendanceTotals } from "./attendance-service.js";
import { lockScheduling } from "./schedule-lock.js";
import { lockBilling } from "./billing-lock.js";
import { ledger, validPayments } from "./analytics.js";
import { localDate, addDays } from "./schedule-time.js";
import { quiet } from "./notifications.js";
import { DailyReportSettings } from "./daily-report-models.js";
import {
  NotificationSettings,
  NotificationJob,
} from "./notification-models.js";
import { TelegramIntegration } from "./telegram-models.js";
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const dailySettingsInput = z
  .object({
    enabled: z.boolean(),
    time,
    timezone: z.literal("Asia/Tashkent"),
    sections: z
      .array(z.enum(["students", "financial", "attendance", "payroll"]))
      .min(1)
      .max(4)
      .refine((v) => new Set(v).size === v.length),
    quietStart: time,
    quietEnd: time,
  })
  .strict();
export function reportPeriod(now: Date) {
  const date = localDate(now);
  return {
    date,
    timezone: "Asia/Tashkent",
    start: new Date(`${date}T00:00:00+05:00`),
    end: new Date(`${addDays(date, 1)}T00:00:00+05:00`),
    asOf: now,
  };
}
function assertSafe(value: unknown): void {
  if (
    typeof value === "number" &&
    (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)
  )
    throw new Error("Report total exceeds safe range");
  if (value && typeof value === "object")
    Object.values(value).forEach(assertSafe);
}
// Snapshot is current as of generation, not a historical reconstruction. Today's
// half-open date window is capped at asOf; monthly payroll is labelled separately.
export async function generateDailyReport(
  tenantId: Types.ObjectId,
  now = new Date(),
) {
  const scope = { tenantId },
    p = reportPeriod(now);
  return mongoose.connection.transaction(
    async (session) => {
      await lockScheduling(tenantId, session);
      await lockBilling(tenantId, session);
      for await (const schedule of Schedule.find({ ...scope, status: "active" })
        .session(session)
        .cursor())
        await materializeSchedule(schedule, p.date, session, p.date);
      const active = await Student.countDocuments({
        ...scope,
        status: "active",
      }).session(session);
      // Explicit date-only inputs are UTC midnight (05:00 Tashkent); omitted
      // dates default to an instant. Both fit the same local-day window.
      const enrolled = await Student.countDocuments({
        ...scope,
        enrollmentDate: {
          $gte: p.start,
          $lt: p.end,
        },
      }).session(session);
      const archived = await Student.countDocuments({
        ...scope,
        archivedAt: { $gte: p.start, $lte: now },
      }).session(session);
      const legacyArchives = await Student.exists({
        ...scope,
        status: "archived",
        archivedAt: null,
      }).session(session);
      const payments = await Payment.aggregate<{
        _id: string;
        amount: number;
        count: number;
      }>([
        { $match: { ...scope, paidAt: { $gte: p.start, $lte: now } } },
        ...validPayments(scope),
        {
          $lookup: {
            from: Charge.collection.name,
            let: { charge: "$chargeId", student: "$studentId" },
            pipeline: [
              {
                $match: {
                  ...scope,
                  cancelled: false,
                  $expr: {
                    $and: [
                      { $eq: ["$_id", "$$charge"] },
                      { $eq: ["$studentId", "$$student"] },
                    ],
                  },
                },
              },
            ],
            as: "charge",
          },
        },
        { $match: { "charge.0": { $exists: true } } },
        {
          $group: {
            _id: "$method",
            amount: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
      ]).session(session);
      const [debt] = await Charge.aggregate<{
        outstanding: number;
        overdue: number;
      }>([
        {
          $match: {
            ...scope,
            cancelled: false,
            billingMonth: { $lte: p.date.slice(0, 7) },
          },
        },
        ...ledger(scope, new Date(+now + 1)),
        {
          $group: {
            _id: null,
            outstanding: { $sum: "$outstanding" },
            overdue: {
              $sum: { $cond: [{ $gt: ["$days", 0] }, "$outstanding", 0] },
            },
          },
        },
      ]).session(session);
      const lessons = await LessonSession.find({
        ...scope,
        lessonDate: p.date,
        status: { $ne: "cancelled" },
      }).session(session);
      const records = await AttendanceRecord.find({
        ...scope,
        sessionId: { $in: lessons.map((l) => l._id) },
      }).session(session);
      const statuses = records
        .filter((r) =>
          lessons.some(
            (l) =>
              l._id.equals(r.sessionId) &&
              l.roster.some((id) => id.equals(r.studentId)),
          ),
        )
        .map((r) => r.status);
      const attendance = attendanceTotals(
        statuses,
        lessons.reduce((n, l) => n + l.roster.length, 0),
      );
      const obligations = await Payroll.find({
        ...scope,
        status: { $in: ["approved", "partially_paid", "paid"] },
        reversedAt: null,
      }).session(session);
      const payouts = await SalaryPayout.aggregate<{
        _id: Types.ObjectId;
        amount: number;
        today: number;
      }>([
        {
          $match: {
            ...scope,
            payrollId: { $in: obligations.map((o) => o._id) },
            paidAt: { $lte: now },
          },
        },
        {
          $lookup: {
            from: SalaryPayoutReversal.collection.name,
            let: { payout: "$_id" },
            pipeline: [
              {
                $match: { ...scope, $expr: { $eq: ["$payoutId", "$$payout"] } },
              },
            ],
            as: "reversals",
          },
        },
        { $match: { "reversals.0": { $exists: false } } },
        {
          $group: {
            _id: "$payrollId",
            amount: { $sum: "$amount" },
            today: {
              $sum: { $cond: [{ $gte: ["$paidAt", p.start] }, "$amount", 0] },
            },
          },
        },
      ]).session(session);
      const report = {
        createdAt: now.toISOString(),
        period: {
          ...p,
          start: p.start.toISOString(),
          end: p.end.toISOString(),
          asOf: now.toISOString(),
        },
        students: {
          active,
          enrolled,
          archived: legacyArchives ? null : archived,
        },
        financial: {
          received: safeTotal(payments.map((r) => r.amount)),
          transactions: safeTotal(payments.map((r) => r.count)),
          outstanding: debt?.outstanding ?? 0,
          overdue: debt?.overdue ?? 0,
          methods: ["cash", "bank_transfer", "click_manual"].map((method) => ({
            method,
            amount: payments.find((r) => r._id === method)?.amount ?? 0,
            count: payments.find((r) => r._id === method)?.count ?? 0,
          })),
        },
        attendance: {
          scheduled: lessons.length,
          completed: lessons.filter((l) => l.status === "completed").length,
          expected: lessons.reduce((n, l) => n + l.roster.length, 0),
          ...attendance,
        },
        payroll: {
          approvedMonthly: safeTotal(
            obligations
              .filter((o) => o.payrollMonth === p.date.slice(0, 7))
              .map((o) => o.finalSalary),
          ),
          paidToday: safeTotal(payouts.map((o) => o.today)),
          outstanding: safeTotal(
            obligations.map((o) =>
              Math.max(
                0,
                o.finalSalary -
                  (payouts.find((r) => r._id.equals(o._id))?.amount ?? 0),
              ),
            ),
          ),
        },
      };
      assertSafe(report);
      return report;
    },
    { readConcern: { level: "snapshot" } },
  );
}
export type DailyReport = Awaited<ReturnType<typeof generateDailyReport>>;
const money = (n: number) => `${new Intl.NumberFormat("uz-UZ").format(n)} so‘m`;
const percent = (n: number | null) => (n === null ? "—" : `${n}%`);
export function formatDailyReport(r: DailyReport, sections: readonly string[]) {
  const lines = [
    "📊 SoftLans Edu — Kunlik hisobot",
    `📅 ${r.period.date.split("-").reverse().join(".")}`,
  ];
  if (sections.includes("students"))
    lines.push(
      `\n👨‍🎓 Hozir faol: ${r.students.active}`,
      `🆕 Bugun qabul: ${r.students.enrolled}`,
      `📦 Bugun arxiv: ${r.students.archived ?? "— (eski arxiv sanalari mavjud emas)"}`,
    );
  if (sections.includes("financial"))
    lines.push(
      `\n💰 Bugungi tushum: ${money(r.financial.received)} (${r.financial.transactions} ta)`,
      `📌 Hozirgi ochiq qarz: ${money(r.financial.outstanding)}`,
      `⏳ Muddati o‘tgan: ${money(r.financial.overdue)}`,
      ...r.financial.methods.map(
        (m) =>
          `${({ cash: "Naqd", bank_transfer: "Bank", click_manual: "Click (qo‘lda)" } as Record<string, string>)[m.method]}: ${money(m.amount)} (${m.count} ta)`,
      ),
    );
  if (sections.includes("attendance"))
    lines.push(
      `\n📚 Bugungi darslar: ${r.attendance.scheduled}; yakunlangan: ${r.attendance.completed}`,
      `Keldi: ${r.attendance.present}; yo‘q: ${r.attendance.absent}; kech: ${r.attendance.late}; sababli: ${r.attendance.excused}`,
      `To‘ldirish: ${percent(r.attendance.coveragePercentage)} (${r.attendance.marked}/${r.attendance.expected})`,
      `✅ Davomat: ${percent(r.attendance.attendancePercentage)} (kelgan + kech / barcha belgilangan)`,
      `Belgilanmagan: ${r.attendance.unmarked}`,
    );
  if (sections.includes("payroll"))
    lines.push(
      `\n👨‍🏫 ${r.period.date.slice(0, 7)} tasdiqlangan maosh: ${money(r.payroll.approvedMonthly)}`,
      `Bugun berilgan: ${money(r.payroll.paidToday)}`,
      `Hozirgi maosh qarzi (barcha oylar): ${money(r.payroll.outstanding)}`,
    );
  const local = new Date(r.createdAt).toLocaleString("uz-UZ", {
    timeZone: "Asia/Tashkent",
  });
  lines.push(
    `\nTuzildi: ${local} (Asia/Tashkent)`,
    "Davr: 00:00 dan tuzilgan vaqtgacha; kun oxiri 24:00.",
    "— ma’lumot mavjud emas. 0 — qayd etilgan natija.",
  );
  return lines.join("\n");
}
export async function ownerEligibility(
  job: InstanceType<typeof NotificationJob>,
  now: Date,
) {
  const scope = { tenantId: job.tenantId, userId: job.userId };
  const s = await DailyReportSettings.findOne(scope);
  const integration = await TelegramIntegration.findOne({
    ...scope,
    status: "connected",
    revision: job.integrationRevision,
    "notificationPreferences.enabled": true,
  });
  const tenantSettings = await NotificationSettings.findOne({
    tenantId: job.tenantId,
  });
  const eligible =
    s &&
    s.revision === job.settingsRevision &&
    (s.enabled || job.kind === "owner_test") &&
    integration?.chatId &&
    (await Tenant.exists({ _id: job.tenantId, active: true })) &&
    (await User.exists({
      _id: job.userId,
      tenantId: job.tenantId,
      active: true,
      role: "business_owner",
    })) &&
    +now - +job.createdAt < 86400000;
  return {
    eligible: !!eligible,
    chatId: integration?.chatId,
    quiet:
      !!s &&
      (quiet(now, s.quietStart, s.quietEnd) ||
        (!!tenantSettings &&
          quiet(now, tenantSettings.quietStart, tenantSettings.quietEnd))),
  };
}
export async function enqueueDailyReport(
  s: InstanceType<typeof DailyReportSettings>,
  test = false,
  now = new Date(),
) {
  const scope = { tenantId: s.tenantId, userId: s.userId };
  const integration = await TelegramIntegration.findOne({
    ...scope,
    status: "connected",
    "notificationPreferences.enabled": true,
  });
  if (
    !integration ||
    !(await Tenant.exists({ _id: s.tenantId, active: true })) ||
    !(await User.exists({
      _id: s.userId,
      tenantId: s.tenantId,
      active: true,
      role: "business_owner",
    }))
  )
    return null;
  const kind = test ? "owner_test" : "owner_daily";
  // Test sends are also bounded to one per date, recipient and tenant.
  const key = `${s.tenantId}:${s.userId}:${kind}:${localDate(now)}`;
  const existing = await NotificationJob.findOne({ tenantId: s.tenantId, key });
  if (existing) return existing;
  const report = await generateDailyReport(s.tenantId, now);
  try {
    return await NotificationJob.findOneAndUpdate(
      { tenantId: s.tenantId, key },
      {
        $setOnInsert: {
          ...scope,
          key,
          kind,
          eventDate: localDate(now),
          integrationRevision: integration.revision,
          settingsRevision: s.revision,
          report,
          reportText:
            (test ? "🧪 Sinov hisobot\n" : "") +
            formatDailyReport(report, s.sections),
        },
      },
      { upsert: true, new: true },
    );
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    return NotificationJob.findOne({ tenantId: s.tenantId, key });
  }
}
export async function planDailyReports(now = new Date()) {
  const date = localDate(now),
    clock = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Tashkent",
      hourCycle: "h23",
      hour: "2-digit",
      minute: "2-digit",
    }).format(now);
  for await (const s of DailyReportSettings.find({
    enabled: true,
    time: { $lte: clock },
  }).cursor()) {
    if (localDate(s.updatedAt) > date) continue;
    await enqueueDailyReport(s, false, now);
  }
}
