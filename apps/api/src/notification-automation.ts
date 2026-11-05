import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { Config } from "./config.js";
import { planDailyReports } from "./daily-reports.js";
import { planNotifications, processNotification } from "./notifications.js";
import { NotificationProcessorState } from "./notification-models.js";
import { telegramConfigured } from "./telegram.js";
import { planSaasReminders } from "./saas-reminders.js";
type Stage =
  | "planning_guardians"
  | "planning_owners"
  | "planning_saas"
  | "delivery"
  | "completed"
  | "failed";
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
  }> = {},
) {
  const tasks = {
    guardians: () => planNotifications(),
    owners: () => planDailyReports(),
    saas: () => planSaasReminders(),
    process: () => processNotification(config),
    pause: () => delay(1200),
    now: Date.now,
    log: (record: object) => console.info(JSON.stringify(record)),
    ...overrides,
  };
  const runId = randomUUID();
  await NotificationProcessorState.findOneAndUpdate(
    { _id: "automation" },
    {
      $set: {
        runId,
        lastStartedAt: new Date(tasks.now()),
        lastHeartbeatAt: new Date(tasks.now()),
        stage: "planning_saas",
      },
    },
    { upsert: true },
  );
  const heartbeat = (stage: Stage) =>
    NotificationProcessorState.updateOne(
      { _id: "automation", runId },
      {
        $set: {
          stage,
          lastHeartbeatAt: new Date(tasks.now()),
          ...(stage === "completed"
            ? { lastCompletedAt: new Date(tasks.now()) }
            : {}),
          ...(stage === "failed"
            ? { lastFailedAt: new Date(tasks.now()) }
            : {}),
        },
      },
    );
  let success = true;
  tasks.log({
    event: "notification_processor",
    stage: "started",
    telegramConfigured: telegramConfigured(config),
  });
  // SaaS in-app reminders do not depend on Telegram credentials or a running worker.
  await heartbeat("planning_saas");
  try {
    await tasks.saas();
  } catch {
    success = false;
    tasks.log({
      event: "notification_processor",
      stage: "planning_saas",
      code: "PLANNING_FAILED",
    });
  }
  if (!telegramConfigured(config)) {
    await heartbeat(success ? "completed" : "failed");
    tasks.log({ event: "notification_processor", stage: success ? "completed" : "failed" });
    return success;
  }
  // A failed report snapshot must not block unrelated guardian attendance deliveries.
  for (const [stage, plan] of [
    ["planning_guardians", tasks.guardians],
    ["planning_owners", tasks.owners],
  ] as const) {
    await heartbeat(stage);
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
  await heartbeat("delivery");
  const deadline = tasks.now() + 45000;
  try {
    while (tasks.now() < deadline) {
      if (!(await tasks.process())) break;
      await heartbeat("delivery");
      await tasks.pause();
    }
  } catch {
    success = false;
    tasks.log({
      event: "notification_processor",
      stage: "delivery",
      code: "PROCESSING_FAILED",
    });
  }
  await heartbeat(success ? "completed" : "failed");
  tasks.log({
    event: "notification_processor",
    stage: success ? "completed" : "failed",
  });
  return success;
}
