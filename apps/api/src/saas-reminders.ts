import type { Types } from "mongoose";
import { Subscription } from "./saas-models.js";
import { SaasReminder } from "./saas-reminders-models.js";
import { Tenant, User } from "./models.js";
import { TelegramIntegration } from "./telegram-models.js";
import { NotificationJob, NotificationSettings } from "./notification-models.js";
import { quiet } from "./notifications.js";

const dayMs = 86_400_000;
export function subscriptionReminderDays(periodEnd: Date, now: Date): 7 | 3 | 1 | null {
  const days = Math.ceil((periodEnd.getTime() - now.getTime()) / dayMs);
  return days === 7 || days === 3 || days === 1 ? days : null;
}

export async function listSaasReminders(tenantId: Types.ObjectId) {
  const rows = await SaasReminder.find({ tenantId }).sort({ createdAt: -1, _id: -1 }).limit(50);
  return rows.map((row) => ({
    id: row._id.toString(), days: row.days, periodEnd: row.periodEnd,
    message: row.message, createdAt: row.createdAt,
  }));
}

// A daily/hourly external scheduler is sufficient; cursors keep memory bounded on Render Free.
// Windows use the server instant. The displayed deadline is always Asia/Tashkent.
export async function planSaasReminders(now = new Date()) {
  for await (const sub of Subscription.find({
    status: { $in: ["active", "trialing"] },
    periodEnd: { $gt: now, $lte: new Date(now.getTime() + 7 * dayMs) },
  }).cursor()) {
    const days = subscriptionReminderDays(sub.periodEnd, now);
    if (days === null || !(await Tenant.exists({ _id: sub.tenantId, active: true }))) continue;
    const deadline = sub.periodEnd.toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent" });
    const message = `SoftLans Edu ${sub.status === "trialing" ? "bepul sinov" : "obuna"} muddati tugashiga ${days} kun qoldi. Tugash vaqti: ${deadline} (Asia/Tashkent). Sozlamalar → Obuna va tariflar bo‘limida yangilang.`;
    const key = { tenantId: sub.tenantId, subscriptionId: sub._id, periodEnd: sub.periodEnd, days };
    await SaasReminder.updateOne(key, { $setOnInsert: { ...key, message } }, { upsert: true }).catch((error) => {
      if (error.code !== 11000) throw error;
    });
    // Consent and live owner role are checked both now and immediately before delivery.
    for await (const owner of User.find({ tenantId: sub.tenantId, active: true, role: "business_owner" }).cursor()) {
      const integration = await TelegramIntegration.findOne({
        tenantId: sub.tenantId, userId: owner._id, status: "connected",
        "notificationPreferences.enabled": true,
      });
      if (!integration?.chatId) continue;
      const jobKey = `saas:${sub._id}:${sub.periodEnd.toISOString()}:${days}:${owner._id}`;
      await NotificationJob.updateOne({ tenantId: sub.tenantId, key: jobKey }, {
        $setOnInsert: {
          tenantId: sub.tenantId, userId: owner._id, key: jobKey,
          nextAttemptAt: now, kind: "saas_expiry", sourceId: sub._id, timing: days,
          version: sub.periodEnd.toISOString(), integrationRevision: integration.revision,
          reportText: message,
        },
      }, { upsert: true }).catch((error) => { if (error.code !== 11000) throw error; });
    }
  }
}

export async function saasReminderEligibility(job: InstanceType<typeof NotificationJob>, now: Date) {
  const integration = await TelegramIntegration.findOne({
    tenantId: job.tenantId, userId: job.userId, status: "connected",
    revision: job.integrationRevision, "notificationPreferences.enabled": true,
  });
  const sub = await Subscription.findOne({
    _id: job.sourceId, tenantId: job.tenantId, status: { $in: ["active", "trialing"] },
  });
  const settings = await NotificationSettings.findOne({ tenantId: job.tenantId });
  const eligible = !!integration?.chatId && !!sub &&
    sub.periodEnd.toISOString() === job.version &&
    subscriptionReminderDays(sub.periodEnd, now) === job.timing &&
    !!(await Tenant.exists({ _id: job.tenantId, active: true })) &&
    !!(await User.exists({ _id: job.userId, tenantId: job.tenantId, active: true, role: "business_owner" }));
  return {
    eligible, chatId: integration?.chatId,
    quiet: quiet(now, settings?.quietStart ?? "21:00", settings?.quietEnd ?? "08:00"),
  };
}
