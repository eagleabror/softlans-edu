import { Api } from "grammy";
import type { Config } from "./config.js";
import { OperationalAlertState } from "./notification-models.js";
import type { SendTelegram } from "./telegram-delivery.js";
import type { platformNotificationSnapshot } from "./notification-monitoring.js";
export const alertCodes = [
  "SCHEDULER_STALE",
  "REPEATED_RUN_FAILURE",
  "DELIVERY_FAILURES",
  "UNKNOWN_OUTCOMES",
  "BACKLOG",
  "STALE_LEASE",
] as const;
export type AlertCode = (typeof alertCodes)[number];
export function evaluateAlerts(
  snapshot: Awaited<ReturnType<typeof platformNotificationSnapshot>>,
  config: Config,
): AlertCode[] {
  const { processor: p, queue: q, legacyQueue: l } = snapshot;
  return [
    ...((config.NOTIFICATION_SCHEDULER_SECRET || p.state !== "never_seen") &&
    p.state !== "recent"
      ? ["SCHEDULER_STALE" as const]
      : []),
    ...(p.consecutiveFailures >= 3 ? ["REPEATED_RUN_FAILURE" as const] : []),
    ...(q.recentFailures + l.recentFailures >= 10
      ? ["DELIVERY_FAILURES" as const]
      : []),
    ...(q.recentUnknownOutcome + l.recentUnknownOutcome >= 3
      ? ["UNKNOWN_OUTCOMES" as const]
      : []),
    ...(q.due + l.due >= config.MONITOR_BACKLOG_THRESHOLD
      ? ["BACKLOG" as const]
      : []),
    ...(p.staleLease ||
    snapshot.schedulerAdmission.staleLease ||
    q.staleSending + l.staleSending > 0
      ? ["STALE_LEASE" as const]
      : []),
  ];
}
async function claim(code: string, cooldown: number, now: Date) {
  await OperationalAlertState.updateOne(
    { _id: code },
    { $setOnInsert: { nextAllowedAt: new Date(0) } },
    { upsert: true },
  ).catch((e) => {
    if (e.code !== 11000) throw e;
  });
  return !!(await OperationalAlertState.findOneAndUpdate(
    { _id: code, nextAllowedAt: { $lte: now } },
    { $set: { nextAllowedAt: new Date(now.getTime() + cooldown) } },
  ));
}
export async function sendOperatorAlert(
  config: Config,
  code: AlertCode,
  send?: SendTelegram,
  now = new Date(),
) {
  // No browser/API can choose a destination or message. Explicit operator opt-in only.
  if (
    !alertCodes.includes(code) ||
    !config.OPERATOR_ALERTS_ENABLED ||
    config.OPERATOR_ALERTS_SUPPRESSED
  )
    return false;
  if (!config.OPERATOR_TELEGRAM_BOT_TOKEN || !config.OPERATOR_TELEGRAM_CHAT_ID)
    return false;
  if (
    !(await claim(code, config.OPERATOR_ALERT_COOLDOWN_MINUTES * 60_000, now))
  )
    return false;
  // A shared cap bounds alerts even if several conditions or API instances fail together.
  if (!(await claim("ALL_ALERTS", 5 * 60_000, now))) return false;
  try {
    await (
      send ??
      ((chat, text) =>
        new Api(config.OPERATOR_TELEGRAM_BOT_TOKEN!, {
          timeoutSeconds: 5,
        }).sendMessage(chat, text))
    )(
      config.OPERATOR_TELEGRAM_CHAT_ID,
      `SoftLans operations: ${code}. Check protected diagnostics and the production runbook.`,
    );
    console.info(
      JSON.stringify({ event: "operator_alert", code, status: "sent" }),
    );
    return true;
  } catch {
    // Consume the cooldown even for ambiguous failures. Never recurse or enqueue retries.
    console.error(
      JSON.stringify({ event: "operator_alert", code, status: "failed" }),
    );
    return false;
  }
}
