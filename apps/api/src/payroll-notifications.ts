import type { ClientSession } from "mongoose";
import { PayrollRun } from "./payroll-automation-models.js";
import { Tenant, User } from "./models.js";
import { TelegramIntegration } from "./telegram-models.js";
import {
  NotificationJob,
  NotificationSettings,
} from "./notification-models.js";
import { quiet } from "./notifications.js";
// Durable in-app run status exists even without Telegram consent. This outbox
// contains only the month and a review prompt, never teacher salaries or names.
export async function enqueuePayrollReady(
  run: InstanceType<typeof PayrollRun>,
  now: Date,
  tx: ClientSession,
) {
  const owners = await User.find({
    tenantId: run.tenantId,
    role: "business_owner",
    active: true,
  }).session(tx);
  for (const owner of owners) {
    const integration = await TelegramIntegration.findOne({
      tenantId: run.tenantId,
      userId: owner._id,
      status: "connected",
      "notificationPreferences.enabled": true,
    }).session(tx);
    if (!integration?.chatId) continue;
    const key = `payroll-ready:${run.month}:${owner._id}`;
    await NotificationJob.updateOne(
      { tenantId: run.tenantId, key },
      {
        $setOnInsert: {
          tenantId: run.tenantId,
          userId: owner._id,
          key,
          kind: "payroll_ready",
          sourceId: run._id,
          eventDate: run.month,
          integrationRevision: integration.revision,
          nextAttemptAt: now,
          reportText: `SoftLans Edu — ${run.month} oyi maosh qoralamalari tayyor. Maoshlar bo‘limida ko‘rib chiqing. Tasdiqlash va to‘lov alohida bajariladi.`,
        },
      },
      { upsert: true, session: tx },
    );
  }
}
export async function payrollReadyEligibility(
  job: InstanceType<typeof NotificationJob>,
  now: Date,
) {
  const integration = await TelegramIntegration.findOne({
    tenantId: job.tenantId,
    userId: job.userId,
    status: "connected",
    revision: job.integrationRevision,
    "notificationPreferences.enabled": true,
  });
  const settings = await NotificationSettings.findOne({
    tenantId: job.tenantId,
  });
  const eligible =
    !!integration?.chatId &&
    !!(await PayrollRun.exists({
      _id: job.sourceId,
      tenantId: job.tenantId,
      month: job.eventDate,
      status: "completed",
    })) &&
    !!(await Tenant.exists({ _id: job.tenantId, active: true })) &&
    !!(await User.exists({
      _id: job.userId,
      tenantId: job.tenantId,
      role: "business_owner",
      active: true,
    }));
  return {
    eligible,
    chatId: integration?.chatId,
    quiet: quiet(
      now,
      settings?.quietStart ?? "21:00",
      settings?.quietEnd ?? "08:00",
    ),
  };
}
