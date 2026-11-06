import type { Types, Model } from "mongoose";
import {
  NotificationJob,
  NotificationProcessorState,
  NotificationSchedulerLease,
} from "./notification-models.js";
import { TelegramDelivery } from "./telegram-models.js";
const QUERY_MS = 3000;
export function processorStatus(
  state: { lastHeartbeatAt?: Date | null; stage?: string | null } | null,
  now: Date,
  staleMs = 180_000,
) {
  return !state
    ? "never_seen"
    : now.getTime() - (state.lastHeartbeatAt?.getTime() ?? 0) > staleMs
      ? "stale"
      : "recent";
}
export function failureCategory(code: string | null) {
  if (code === "UNKNOWN_OUTCOME") return "unknown_outcome";
  if (code === "TELEGRAM_429") return "rate_limited";
  if (code && /^TELEGRAM_5\d\d$/.test(code)) return "telegram_server";
  if (code && /^TELEGRAM_4\d\d$/.test(code)) return "telegram_rejected";
  if (code === "CHECK_FAILED") return "eligibility_check";
  return "other";
}
export async function queueSnapshot(
  tenantId?: Types.ObjectId,
  now = new Date(),
  legacy = false,
) {
  // Both queues share these operational fields; no payload fields are selected.
  const model = (legacy
    ? TelegramDelivery
    : NotificationJob) as unknown as Model<{
    tenantId: Types.ObjectId;
    status: string;
    errorCode?: string;
    nextAttemptAt?: Date;
    leaseUntil?: Date;
    updatedAt: Date;
  }>;
  const scope = tenantId ? { tenantId } : {};
  const recent = new Date(now.getTime() - 15 * 60_000);
  const [rows, failures, due, staleSending, oldest] = await Promise.all([
    model
      .aggregate<{ _id: string; count: number }>([
        { $match: scope },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ])
      .option({ maxTimeMS: QUERY_MS, allowDiskUse: false }),
    model
      .aggregate<{ _id: string | null; count: number; recent: number }>([
        {
          $match: {
            ...scope,
            status: { $in: ["failed", "pending"] },
            errorCode: { $type: "string" },
          },
        },
        {
          $group: {
            _id: "$errorCode",
            count: { $sum: 1 },
            recent: {
              $sum: { $cond: [{ $gte: ["$updatedAt", recent] }, 1, 0] },
            },
          },
        },
      ])
      .option({ maxTimeMS: QUERY_MS, allowDiskUse: false }),
    model
      .countDocuments({
        ...scope,
        status: "pending",
        nextAttemptAt: { $lte: now },
      })
      .maxTimeMS(QUERY_MS),
    model
      .countDocuments({
        ...scope,
        status: "sending",
        leaseUntil: { $lte: now },
      })
      .maxTimeMS(QUERY_MS),
    model
      .findOne({ ...scope, status: "pending", nextAttemptAt: { $lte: now } })
      .sort({ nextAttemptAt: 1 })
      .select("nextAttemptAt -_id")
      .maxTimeMS(QUERY_MS),
  ]);
  const counts = { pending: 0, sending: 0, sent: 0, failed: 0, cancelled: 0 };
  for (const row of rows)
    if (Object.hasOwn(counts, row._id))
      counts[row._id as keyof typeof counts] = row.count;
  const byCategory: Record<string, number> = {};
  let recentFailures = 0,
    recentUnknownOutcome = 0;
  for (const row of failures) {
    const category = failureCategory(row._id);
    byCategory[category] = (byCategory[category] ?? 0) + row.count;
    recentFailures += row.recent;
    if (category === "unknown_outcome") recentUnknownOutcome += row.recent;
  }
  return {
    counts,
    due,
    staleSending,
    oldestDueAt: oldest?.nextAttemptAt ?? null,
    failuresByCategory: byCategory,
    unknownOutcome: byCategory.unknown_outcome ?? 0,
    recentFailures,
    recentUnknownOutcome,
    recentWindowMinutes: 15,
  };
}
export async function platformNotificationSnapshot(
  now = new Date(),
  staleMs = 180_000,
) {
  const [state, lease, admission, queue, legacyQueue] = await Promise.all([
    NotificationProcessorState.findById("automation"),
    NotificationSchedulerLease.findById("automation"),
    NotificationSchedulerLease.findById("http"),
    queueSnapshot(undefined, now),
    queueSnapshot(undefined, now, true),
  ]);
  return {
    generatedAt: now,
    schedulerAdmission: {
      leaseActive:
        !!admission?.leaseId &&
        (admission.leaseUntil?.getTime() ?? 0) > now.getTime(),
      staleLease:
        !!admission?.leaseId &&
        (admission.leaseUntil?.getTime() ?? 0) <= now.getTime(),
    },
    processor: {
      state: processorStatus(state, now, staleMs),
      stage: state?.stage ?? null,
      staleAfterSeconds: staleMs / 1000,
      lastStartedAt: state?.lastStartedAt ?? null,
      lastHeartbeatAt: state?.lastHeartbeatAt ?? null,
      lastCompletedAt: state?.lastCompletedAt ?? null,
      lastFailedAt: state?.lastFailedAt ?? null,
      lastInterruptedAt: state?.lastInterruptedAt ?? null,
      consecutiveFailures: state?.consecutiveFailures ?? 0,
      interruptedRuns: state?.interruptedRuns ?? 0,
      leaseActive:
        !!lease?.leaseId && (lease.leaseUntil?.getTime() ?? 0) > now.getTime(),
      staleLease:
        !!lease?.leaseId && (lease.leaseUntil?.getTime() ?? 0) <= now.getTime(),
    },
    queue,
    legacyQueue,
  };
}
