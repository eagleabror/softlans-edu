import type { Types } from "mongoose";
import type { Config } from "./config.js";
import {
  AttendanceEvent,
  GuardianLink,
  NotificationJob,
  NotificationProcessorState,
  NotificationSettings,
} from "./notification-models.js";
import { LessonSession } from "./attendance-models.js";
import { Student } from "./models.js";
import { AppError } from "./errors.js";
import { attendanceEnabled, quiet } from "./notifications.js";
import { telegramConfigured } from "./telegram.js";
// No names, financial data, Telegram IDs, source IDs, message text, or raw errors.
export async function notificationDiagnostics(
  config: Config,
  tenantId: Types.ObjectId,
  target?: { studentId: string; sessionId: string },
  now = new Date(),
) {
  const state = await NotificationProcessorState.findById("automation");
  const processor = {
    mode: "external_scheduler" as const,
    state: !state
      ? "never_seen"
      : now.getTime() - (state.lastHeartbeatAt?.getTime() ?? 0) > 180000
        ? "stale"
        : "recent",
    lastStartedAt: state?.lastStartedAt ?? null,
    lastHeartbeatAt: state?.lastHeartbeatAt ?? null,
    lastCompletedAt: state?.lastCompletedAt ?? null,
    lastFailedAt: state?.lastFailedAt ?? null,
    stage: state?.stage ?? null,
  };
  const result = {
    telegramConfigured: telegramConfigured(config),
    schedulerEndpointConfigured: !!config.NOTIFICATION_SCHEDULER_SECRET,
    processor,
  };
  if (!target) return result;
  const scope = { tenantId };
  const [student, session] = await Promise.all([
    Student.findOne({ ...scope, _id: target.studentId }).select("status"),
    LessonSession.findOne({ ...scope, _id: target.sessionId }).select(
      "status roster",
    ),
  ]);
  if (
    !student ||
    !session ||
    !session.roster.some((id) => id.toString() === target.studentId)
  )
    throw new AppError(404, "NOT_FOUND", "Ma’lumot topilmadi.");
  const event = await AttendanceEvent.findOne({ ...scope, ...target }).sort({
    revision: -1,
  });
  const s =
    (await NotificationSettings.findOne(scope)) ??
    new NotificationSettings(scope);
  const verified = {
    ...scope,
    studentId: target.studentId,
    verifiedAt: { $exists: true },
  };
  const verifiedGuardians = await GuardianLink.countDocuments(verified);
  const consenting = {
    ...verified,
    enabled: true,
    consentAt: { $exists: true },
  };
  const consentingGuardians = await GuardianLink.countDocuments(consenting);
  const attendanceRecipients = await GuardianLink.countDocuments({
    ...consenting,
    attendance: true,
  });
  const rows = event
    ? await NotificationJob.aggregate<{ _id: string; count: number }>([
        {
          $match: {
            ...scope,
            studentId: student._id,
            kind: "attendance",
            sourceId: event._id,
          },
        },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ])
    : [];
  const jobs = Object.fromEntries(rows.map((row) => [row._id, row.count]));
  let reason = "WAITING_FOR_PLANNER";
  if (!telegramConfigured(config)) reason = "TELEGRAM_NOT_CONFIGURED";
  else if (student.status !== "active") reason = "STUDENT_INACTIVE";
  else if (session.status === "cancelled") reason = "SESSION_CANCELLED";
  else if (!event) reason = "NO_ATTENDANCE_EVENT";
  else if (now.getTime() - event.createdAt.getTime() > 7 * 86400000)
    reason = "EVENT_EXPIRED";
  else if (!s.attendance) reason = "TENANT_ATTENDANCE_DISABLED";
  else if (!attendanceEnabled(s, event.status, !!event.correction))
    reason = "ATTENDANCE_POLICY_DISABLED";
  else if (!verifiedGuardians) reason = "NO_VERIFIED_GUARDIAN";
  else if (!consentingGuardians) reason = "NO_GUARDIAN_CONSENT";
  else if (!attendanceRecipients) reason = "RECIPIENT_ATTENDANCE_DISABLED";
  else if (jobs.pending)
    reason = quiet(now, s.quietStart, s.quietEnd)
      ? "QUIET_HOURS"
      : "DELIVERY_PENDING";
  else if (jobs.sending) reason = "DELIVERY_IN_PROGRESS";
  else if (jobs.failed) reason = "DELIVERY_FAILED";
  else if (jobs.sent) reason = "DELIVERED";
  else if (jobs.cancelled) reason = "DELIVERY_CANCELLED";
  return {
    ...result,
    attendance: {
      reason,
      eventRecorded: !!event,
      verifiedGuardians,
      consentingGuardians,
      attendanceRecipients,
      jobs,
    },
  };
}
