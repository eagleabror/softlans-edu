import { randomUUID } from "node:crypto";
import { Api, GrammyError } from "grammy";
import type { Types } from "mongoose";
import type { Config } from "./config.js";
import {
  GuardianLink,
  NotificationSettings,
  NotificationJob,
  AttendanceEvent,
} from "./notification-models.js";
import { Student, Tenant } from "./models.js";
import { Charge } from "./billing-models.js";
import { Schedule } from "./schedule-models.js";
import { Group, Membership } from "./group-models.js";
import { LessonSession } from "./attendance-models.js";
import { TelegramDispatch } from "./telegram-models.js";
import { addDays, localDate, occursBetween } from "./schedule-time.js";
import { retryDelay, type SendTelegram } from "./telegram-delivery.js";
import { telegramConfigured } from "./telegram.js";
type Settings = InstanceType<typeof NotificationSettings>;
type Job = InstanceType<typeof NotificationJob>;
export function quiet(now: Date, start: string, end: string) {
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tashkent",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  return start === end
    ? false
    : start < end
      ? time >= start && time < end
      : time >= start || time < end;
}
export function debtEligible(charge: {
  cancelled: boolean;
  finalAmount: number;
  paidAmount: number;
}) {
  return !charge.cancelled && charge.finalAmount > charge.paidAmount;
}
export function attendanceEnabled(
  s: Pick<Settings, "attendance" | "late" | "excused" | "corrections">,
  status: string,
  correction: boolean,
) {
  return (
    s.attendance &&
    (correction
      ? s.corrections
      : status === "absent" ||
        (status === "late" && s.late) ||
        (status === "excused" && s.excused))
  );
}
export async function enqueueNotification(
  guardian: InstanceType<typeof GuardianLink>,
  event: {
    key: string;
    kind: string;
    sourceId?: Types.ObjectId;
    eventDate?: string;
    timing?: number;
    version?: string;
  },
) {
  const key = `${guardian._id}:${event.key}`;
  try {
    return await NotificationJob.findOneAndUpdate(
      { tenantId: guardian.tenantId, key },
      {
        $setOnInsert: {
          ...event,
          key,
          tenantId: guardian.tenantId,
          guardianId: guardian._id,
          studentId: guardian.studentId,
          guardianRevision: guardian.revision,
        },
      },
      { upsert: true, new: true },
    );
  } catch (e) {
    if ((e as { code?: number }).code !== 11000) throw e;
  }
}
// Bounded catch-up: debts on their Tashkent event date, lessons within one hour,
// attendance seven days. Cursor traversal avoids loading the tenant population into RAM.
export async function planNotifications(now = new Date()) {
  await GuardianLink.updateMany(
    { tokenExpiresAt: { $lte: now } },
    { $unset: { tokenHash: 1, tokenExpiresAt: 1 } },
  );
  for await (const s of NotificationSettings.find({
    $or: [{ debt: true }, { attendance: true }, { lesson: true }],
  }).cursor()) {
    const scope = { tenantId: s.tenantId };
    if (!(await Tenant.exists({ _id: s.tenantId, active: true }))) continue;
    for await (const g of GuardianLink.find({
      ...scope,
      enabled: true,
      verifiedAt: { $exists: true },
      consentAt: { $exists: true },
    }).cursor()) {
      const student = { ...scope, studentId: g.studentId };
      if (
        !(await Student.exists({
          _id: g.studentId,
          ...scope,
          status: "active",
        }))
      )
        continue;
      if (s.debt && g.debt)
        for (const offset of s.debtDays) {
          const due = addDays(localDate(now), -offset);
          for await (const c of Charge.find({
            ...student,
            cancelled: false,
            dueDate: {
              $gte: new Date(`${due}T00:00:00+05:00`),
              $lt: new Date(`${addDays(due, 1)}T00:00:00+05:00`),
            },
          }).cursor()) {
            if (debtEligible(c))
              await enqueueNotification(g, {
                kind: "debt",
                key: `debt:${c._id}:${due}:${offset}`,
                sourceId: c._id,
                eventDate: due,
                timing: offset,
              });
          }
        }
      if (s.attendance && g.attendance)
        for await (const e of AttendanceEvent.find({
          ...student,
          createdAt: { $gte: new Date(now.getTime() - 7 * 86400000) },
        }).cursor()) {
          if (attendanceEnabled(s, e.status, !!e.correction))
            await enqueueNotification(g, {
              kind: "attendance",
              key: `attendance:${e._id}`,
              sourceId: e._id,
            });
        }
      if (s.lesson && g.lesson)
        for await (const m of Membership.find({
          ...student,
          status: "active",
        }).cursor()) {
          for await (const schedule of Schedule.find({
            ...scope,
            groupId: m.groupId,
            status: "active",
          }).cursor()) {
            for (let day = 0; day <= 2; day++) {
              const date = addDays(localDate(now), day);
              if (!occursBetween(schedule, date, date)) continue;
              const instant = new Date(
                `${date}T${schedule.startTime}:00+05:00`,
              ).getTime();
              for (const hours of s.lessonHours) {
                const due = instant - hours * 3600000;
                if (
                  due <= now.getTime() &&
                  now.getTime() < due + 3600000 &&
                  instant > now.getTime()
                )
                  await enqueueNotification(g, {
                    kind: "lesson",
                    key: `lesson:${schedule._id}:${date}:${schedule.updatedAt.getTime()}:${hours}`,
                    sourceId: schedule._id,
                    eventDate: date,
                    timing: hours,
                    version: schedule.updatedAt.toISOString(),
                  });
              }
            }
          }
        }
    }
  }
}
export async function sourceEligible(job: Job, s: Settings, now: Date) {
  const scope = { tenantId: job.tenantId };
  if (job.kind === "test")
    return now.getTime() - job.createdAt.getTime() < 3600000;
  if (job.kind === "debt") {
    if (!s.debt || !s.debtDays.includes(job.timing!)) return false;
    const c = await Charge.findOne({
      ...scope,
      _id: job.sourceId,
      studentId: job.studentId,
    });
    return (
      !!c &&
      debtEligible(c) &&
      localDate(c.dueDate) === job.eventDate &&
      localDate(now) === addDays(job.eventDate!, job.timing!)
    );
  }
  if (job.kind === "attendance") {
    const e = await AttendanceEvent.findOne({
      ...scope,
      _id: job.sourceId,
      studentId: job.studentId,
    });
    if (
      !e ||
      !attendanceEnabled(s, e.status, !!e.correction) ||
      now.getTime() - e.createdAt.getTime() > 7 * 86400000
    )
      return false;
    const latest = await AttendanceEvent.findOne({
      ...scope,
      sessionId: e.sessionId,
      studentId: e.studentId,
    }).sort({ revision: -1 });
    return (
      latest?._id.equals(e._id) &&
      !!(await LessonSession.exists({
        ...scope,
        _id: e.sessionId,
        status: { $ne: "cancelled" },
      }))
    );
  }
  if (!s.lesson || !s.lessonHours.includes(job.timing!)) return false;
  const schedule = await Schedule.findOne({
    ...scope,
    _id: job.sourceId,
    status: "active",
  });
  if (
    !schedule ||
    schedule.updatedAt.toISOString() !== job.version ||
    !occursBetween(schedule, job.eventDate!, job.eventDate!)
  )
    return false;
  const instant = new Date(`${job.eventDate}T${schedule.startTime}:00+05:00`);
  const group = await Group.findOne({
    ...scope,
    _id: schedule.groupId,
    status: "active",
    startDate: { $lte: instant },
  });
  const session = await LessonSession.findOne({
    ...scope,
    scheduleId: schedule._id,
    lessonDate: job.eventDate,
  });
  return (
    !!group &&
    instant > now &&
    (!session ||
      (session.status !== "cancelled" &&
        session.startTime === schedule.startTime &&
        session.roster.some((id) => id.equals(job.studentId)))) &&
    !!(await Membership.exists({
      ...scope,
      groupId: schedule.groupId,
      studentId: job.studentId,
      status: "active",
      enrolledAt: { $lte: now },
    }))
  );
}
const defaults = {
  uz: {
    debt: "Assalomu alaykum! O‘quv markazidagi to‘lov muddati bo‘yicha eslatma mavjud. Batafsil ma’lumot uchun markaz ma’muriyatiga murojaat qiling.",
    attendance:
      "Assalomu alaykum! Farzandingizning dars davomati bo‘yicha yangilanish mavjud. Batafsil ma’lumot uchun markaz bilan bog‘laning.",
    lesson:
      "Assalomu alaykum! Yaqinlashayotgan dars bo‘yicha eslatma. Batafsil ma’lumot uchun markaz bilan bog‘laning.",
    test: "SoftLans Edu: sinov xabari.",
  },
  ru: {
    debt: "Здравствуйте! Напоминание об оплате занятий. За подробностями обратитесь в учебный центр.",
    attendance:
      "Здравствуйте! Есть обновление посещаемости занятий. Обратитесь в учебный центр.",
    lesson:
      "Здравствуйте! Напоминание о предстоящем занятии. Обратитесь в учебный центр.",
    test: "SoftLans Edu: тестовое уведомление.",
  },
};
export async function processNotification(
  config: Config,
  send?: SendTelegram,
  now = new Date(),
) {
  if (!telegramConfigured(config)) return false;
  await NotificationJob.updateMany(
    { status: "sending", leaseUntil: { $lte: now } },
    {
      $set: { status: "failed", errorCode: "UNKNOWN_OUTCOME" },
      $unset: { leaseId: 1, leaseUntil: 1 },
    },
  );
  await TelegramDispatch.updateOne(
    { _id: "bot" },
    { $setOnInsert: { availableAt: now } },
    { upsert: true },
  ).catch((e) => {
    if (e.code !== 11000) throw e;
  });
  const permit = await TelegramDispatch.findOneAndUpdate(
    { _id: "bot", availableAt: { $lte: now } },
    { $set: { availableAt: new Date(now.getTime() + 60000) } },
  );
  if (!permit) return false;
  const leaseId = randomUUID();
  const job = await NotificationJob.findOneAndUpdate(
    { status: "pending", nextAttemptAt: { $lte: now }, attempts: { $lt: 5 } },
    {
      $set: {
        status: "sending",
        leaseId,
        leaseUntil: new Date(now.getTime() + 60000),
      },
    },
    { new: true, sort: { nextAttemptAt: 1 } },
  );
  let pacing = 1100;
  let sendStarted = false;
  try {
    if (!job) return false;
    const finish = (values: object, code?: string) =>
      NotificationJob.updateOne(
        { _id: job._id, status: "sending", leaseId },
        {
          $set: values,
          $unset: { leaseId: 1, leaseUntil: 1 },
          ...(code ? { $push: { attemptsLog: { at: new Date(), code } } } : {}),
        },
      );
    const g = await GuardianLink.findOne({
      _id: job.guardianId,
      tenantId: job.tenantId,
      studentId: job.studentId,
      revision: job.guardianRevision,
      enabled: true,
      consentAt: { $exists: true },
      verifiedAt: { $exists: true },
    }).select("+chatId");
    const s =
      (await NotificationSettings.findOne({ tenantId: job.tenantId })) ??
      new NotificationSettings({ tenantId: job.tenantId });
    if (
      !g?.chatId ||
      (job.kind !== "test" && !g.get(job.kind)) ||
      !(await Tenant.exists({ _id: job.tenantId, active: true })) ||
      !(await Student.exists({
        _id: job.studentId,
        tenantId: job.tenantId,
        status: "active",
      })) ||
      !(await sourceEligible(job, s, now))
    ) {
      await finish({ status: "cancelled", errorCode: "INELIGIBLE" });
      return true;
    }
    if (quiet(now, s.quietStart, s.quietEnd)) {
      await finish({
        status: "pending",
        nextAttemptAt: new Date(now.getTime() + 60000),
      });
      return true;
    }
    // Fence immediately before the external side effect; the API itself cannot be fenced.
    const claim = await NotificationJob.updateOne(
      {
        _id: job._id,
        status: "sending",
        leaseId,
        leaseUntil: { $gt: new Date() },
      },
      { $inc: { attempts: 1 } },
    );
    if (!claim.modifiedCount) return true;
    const text =
      job.kind === "test"
        ? defaults[s.language].test
        : s.get(`${job.kind}Template`) || defaults[s.language][job.kind];
    try {
      sendStarted = true;
      await (
        send ??
        ((chat, message) =>
          new Api(config.TELEGRAM_BOT_TOKEN!, {
            timeoutSeconds: 10,
          }).sendMessage(chat, message))
      )(g.chatId, text);
      await finish(
        { status: "sent", sentAt: new Date(), errorCode: null },
        "SENT",
      );
    } catch (error) {
      const api = error instanceof GrammyError ? error : null;
      const code = api?.error_code;
      const retry =
        (code === 429 || (code !== undefined && code >= 500)) &&
        job.attempts + 1 < 5;
      const delay = retryDelay(job.attempts + 1, api?.parameters.retry_after);
      const safeCode = code ? `TELEGRAM_${code}` : "UNKNOWN_OUTCOME";
      await finish(
        {
          status: retry ? "pending" : "failed",
          errorCode: safeCode,
          nextAttemptAt: new Date(Date.now() + delay),
        },
        safeCode,
      );
      if (code === 429) pacing = delay;
      if (code === 403 || code === 400)
        await GuardianLink.updateOne(
          { _id: g._id, revision: g.revision },
          {
            $set: { enabled: false, withdrawnAt: new Date() },
            $inc: { revision: 1 },
          },
        );
    }
    return true;
  } catch (error) {
    if (job && !sendStarted) {
      await NotificationJob.updateOne(
        { _id: job._id, status: "sending", leaseId },
        {
          $set: {
            status: job.attempts + 1 < 5 ? "pending" : "failed",
            errorCode: "CHECK_FAILED",
            nextAttemptAt: new Date(Date.now() + retryDelay(job.attempts + 1)),
          },
          $inc: { attempts: 1 },
          $unset: { leaseId: 1, leaseUntil: 1 },
          $push: { attemptsLog: { at: new Date(), code: "CHECK_FAILED" } },
        },
      );
    }
    throw error;
  } finally {
    await TelegramDispatch.updateOne(
      { _id: "bot" },
      { $set: { availableAt: new Date(Date.now() + pacing) } },
    );
  }
}
