import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { Config } from "./config.js";
import { planDailyReports } from "./daily-reports.js";
import { planNotifications, processNotification } from "./notifications.js";
import { NotificationProcessorState } from "./notification-models.js";
import { telegramConfigured } from "./telegram.js";
import { planSaasReminders } from "./saas-reminders.js";
import {
  acquireRunLease,
  renewRunLease,
  releaseRunLease,
} from "./notification-lease.js";
type Stage =
  "planning_guardians" | "planning_owners" | "planning_saas" | "delivery";
export async function runNotificationAutomation(
  config: Config,
  overrides: Partial<{
    guardians: () => Promise<unknown>;
    owners: () => Promise<unknown>;
    saas: () => Promise<unknown>;
    process: () => Promise<boolean>;
    pause: () => Promise<unknown>;
    now: () => number;
    log: (record: object) => void;
    signal: AbortSignal;
  }> = {},
) {
  const tasks = {
    guardians: () => planNotifications(),
    owners: () => planDailyReports(),
    saas: () => planSaasReminders(),
    process: () =>
      processNotification(config, undefined, new Date(), {
        signal: overrides.signal,
        ownsRun: () => renewRunLease(leaseId!),
      }),
    pause: () => delay(1200, undefined, { signal: overrides.signal }),
    now: Date.now,
    log: (record: object) => console.info(JSON.stringify(record)),
    ...overrides,
  };
  if (tasks.signal?.aborted) return false;
  // Shared by the HTTP trigger and CLI; HTTP admission alone cannot serialize both.
  const leaseId = await acquireRunLease(new Date(tasks.now()));
  if (!leaseId) {
    tasks.log({
      event: "notification_processor",
      stage: "skipped",
      code: "ALREADY_RUNNING",
    });
    return false;
  }
  const runId = randomUUID();
  let stage: Stage = "planning_saas",
    success = true,
    leaseLost = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let renewal: Promise<void> | undefined;
  const interrupted = new Error("RUN_INTERRUPTED");
  const checkpoint = async () => {
    if (tasks.signal?.aborted || leaseLost) throw interrupted;
    if (!(await renewRunLease(leaseId, new Date(tasks.now())))) {
      leaseLost = true;
      throw interrupted;
    }
    await NotificationProcessorState.updateOne(
      { _id: "automation", runId },
      { $set: { stage, lastHeartbeatAt: new Date(tasks.now()) } },
    );
  };
  try {
    const previous = await NotificationProcessorState.findById("automation");
    const recovered =
      previous &&
      !["completed", "failed", "interrupted"].includes(previous.stage ?? "");
    await NotificationProcessorState.findOneAndUpdate(
      { _id: "automation" },
      {
        $set: {
          runId,
          stage,
          lastStartedAt: new Date(tasks.now()),
          lastHeartbeatAt: new Date(tasks.now()),
          ...(recovered
            ? {
                lastInterruptedAt: new Date(tasks.now()),
                lastFailedAt: new Date(tasks.now()),
              }
            : {}),
        },
        ...(recovered
          ? { $inc: { interruptedRuns: 1, consecutiveFailures: 1 } }
          : {}),
      },
      { upsert: true },
    );
    if (recovered)
      tasks.log({
        event: "notification_processor",
        stage: "recovered",
        code: "PREVIOUS_RUN_INTERRUPTED",
      });
    tasks.log({
      event: "notification_processor",
      stage: "started",
      telegramConfigured: telegramConfigured(config),
    });
    // Renew during slow planning too. A failed renewal stops new side effects.
    timer = setInterval(() => {
      if (renewal) return;
      renewal = checkpoint()
        .catch(() => {
          leaseLost = true;
        })
        .finally(() => {
          renewal = undefined;
        });
    }, 15_000).unref();
    for (const [nextStage, plan] of [
      ["planning_saas", tasks.saas],
      ...(telegramConfigured(config)
        ? ([
            ["planning_guardians", tasks.guardians],
            ["planning_owners", tasks.owners],
          ] as const)
        : []),
    ] as const) {
      stage = nextStage;
      await checkpoint();
      try {
        await plan();
      } catch {
        success = false;
        tasks.log({
          event: "notification_processor",
          stage,
          code: "PLANNING_FAILED",
        });
      }
    }
    if (telegramConfigured(config)) {
      stage = "delivery";
      // Cooperative delivery budget: a single in-flight call may extend beyond it.
      const deadline = tasks.now() + 45_000;
      while (tasks.now() < deadline) {
        await checkpoint();
        if (!(await tasks.process())) break;
        await tasks.pause();
      }
    }
    await checkpoint();
  } catch (error) {
    success = false;
    if (error !== interrupted && !tasks.signal?.aborted && !leaseLost)
      tasks.log({
        event: "notification_processor",
        stage,
        code: "PROCESSING_FAILED",
      });
  } finally {
    clearInterval(timer);
    await renewal;
    const stopped = !!tasks.signal?.aborted || leaseLost;
    let outcome = stopped ? "interrupted" : success ? "completed" : "failed";
    try {
      // Never overwrite the successor's state or report an interrupted run completed.
      if (await renewRunLease(leaseId, new Date(tasks.now()))) {
        await NotificationProcessorState.updateOne(
          { _id: "automation", runId },
          {
            $set: {
              stage: outcome,
              lastHeartbeatAt: new Date(tasks.now()),
              ...(outcome === "completed"
                ? {
                    lastCompletedAt: new Date(tasks.now()),
                    consecutiveFailures: 0,
                  }
                : {
                    lastFailedAt: new Date(tasks.now()),
                    ...(stopped
                      ? { lastInterruptedAt: new Date(tasks.now()) }
                      : {}),
                  }),
            },
            ...(outcome !== "completed"
              ? {
                  $inc: {
                    consecutiveFailures: 1,
                    ...(stopped ? { interruptedRuns: 1 } : {}),
                  },
                }
              : {}),
          },
        );
      } else {
        success = false;
        outcome = "interrupted";
      }
      tasks.log({ event: "notification_processor", stage: outcome });
    } finally {
      await releaseRunLease(leaseId);
    }
  }
  return success && !tasks.signal?.aborted && !leaseLost;
}
