import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { connectDatabase } from "../src/db.js";
import { ensureIndexes, Tenant, User } from "../src/models.js";
import { Subscription } from "../src/saas-models.js";
import { SaasReminder } from "../src/saas-reminders-models.js";
import { listSaasReminders, planSaasReminders, saasReminderEligibility, subscriptionReminderDays } from "../src/saas-reminders.js";
import { NotificationJob, NotificationSettings } from "../src/notification-models.js";
import { TelegramIntegration, TelegramDispatch } from "../src/telegram-models.js";
import { runNotificationAutomation } from "../src/notification-automation.js";
import { processNotification } from "../src/notifications.js";
import { parseConfig } from "../src/config.js";

const dayMs = 86_400_000;
const oid = () => new mongoose.Types.ObjectId();
const config = parseConfig({
  NODE_ENV: "test", APP_ORIGIN: "http://localhost:5173", MONGODB_URI: "mongodb://localhost/test",
  JWT_SECRET: "j".repeat(48), TELEGRAM_BOT_TOKEN: "123:test",
  TELEGRAM_BOT_USERNAME: "softlans_test_bot", TELEGRAM_WEBHOOK_SECRET: "w".repeat(48),
});
let repl: MongoMemoryReplSet;
let tenantId: mongoose.Types.ObjectId;
let ownerId: mongoose.Types.ObjectId;
beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: "7.0.24" } });
  await connectDatabase(repl.getUri("saas-reminders"));
  await ensureIndexes();
  await SaasReminder.createIndexes();
});
afterAll(async () => { await mongoose.disconnect(); await repl?.stop(); });
beforeEach(async () => {
  for (const model of Object.values(mongoose.models)) await model.collection.deleteMany({});
  tenantId = (await Tenant.create({ name: "Test markazi" }))._id;
  ownerId = (await User.create({ tenantId, name: "Egasi", email: "owner@example.test", role: "business_owner", passwordHash: "test-only" }))._id;
});
const subscription = (periodEnd: Date, status = "active") => Subscription.create({
  tenantId, planId: oid(), planName: "Starter", planCode: "starter", status,
  periodStart: new Date(periodEnd.getTime() - 30 * dayMs), periodEnd,
  agreedPriceUZS: 149000, studentLimit: 100, groupLimit: 10,
});
const integration = (enabled = true) => TelegramIntegration.create({
  tenantId, userId: ownerId, chatId: "12345", status: "connected", notificationPreferences: { enabled },
});

it("uses server-time windows for 7, 3 and 1 days without early or expired reminders", () => {
  const now = new Date("2026-10-31T10:00:00Z");
  for (const days of [7, 3, 1] as const) {
    expect(subscriptionReminderDays(new Date(+now + days * dayMs), now)).toBe(days);
    expect(subscriptionReminderDays(new Date(+now + (days - 1) * dayMs + 1), now)).toBe(days);
  }
  for (const days of [8, 6, 4, 2, 0, -1])
    expect(subscriptionReminderDays(new Date(+now + days * dayMs), now)).toBeNull();
});

it("deduplicates simultaneous reminder runs per period and preserves each threshold", async () => {
  const now = new Date("2026-10-31T10:00:00Z");
  const end = new Date(+now + 7 * dayMs);
  await subscription(end);
  await Promise.all([planSaasReminders(now), planSaasReminders(now)]);
  expect(await SaasReminder.countDocuments()).toBe(1);
  expect(await NotificationJob.countDocuments()).toBe(0);
  await planSaasReminders(new Date(+end - 3 * dayMs));
  await planSaasReminders(new Date(+end - dayMs));
  expect(await SaasReminder.countDocuments()).toBe(3);
  expect((await listSaasReminders(tenantId))[0]!.message).toContain("Asia/Tashkent");
  expect(await listSaasReminders(oid())).toEqual([]);
  await Subscription.updateOne({ tenantId }, { $set: { periodEnd: new Date(+end + 30 * dayMs) } });
  await planSaasReminders(new Date(+end + 23 * dayMs));
  expect(await SaasReminder.countDocuments()).toBe(4);
});

it("does not remind cancelled, suspended, expired or administratively blocked centers", async () => {
  const now = new Date();
  const sub = await subscription(new Date(+now + dayMs));
  for (const status of ["cancelled", "suspended", "expired", "past_due"]) {
    await Subscription.updateOne({ _id: sub._id }, { $set: { status } });
    await planSaasReminders(now);
  }
  await Subscription.updateOne({ _id: sub._id }, { $set: { status: "active" } });
  await Tenant.updateOne({ _id: tenantId }, { $set: { active: false } });
  await planSaasReminders(now);
  expect(await SaasReminder.countDocuments()).toBe(0);
});

it("creates durable in-app reminders without Telegram and skips the Telegram processor", async () => {
  await subscription(new Date(Date.now() + 3 * dayMs), "trialing");
  const process = vi.fn();
  expect(await runNotificationAutomation({ ...config, TELEGRAM_BOT_TOKEN: undefined }, {
    process, log: () => {},
  })).toBe(true);
  expect(await SaasReminder.countDocuments()).toBe(1);
  expect(process).not.toHaveBeenCalled();
});

it("queues only opted-in connected owners and cancels stale deadlines or withdrawn consent", async () => {
  const now = new Date("2026-10-31T10:00:00Z");
  const sub = await subscription(new Date(+now + 3 * dayMs));
  const link = await integration(false);
  await planSaasReminders(now);
  expect(await NotificationJob.countDocuments()).toBe(0);
  await TelegramIntegration.updateOne({ _id: link._id }, { $set: { "notificationPreferences.enabled": true } });
  await Promise.all([planSaasReminders(now), planSaasReminders(now)]);
  expect(await NotificationJob.countDocuments()).toBe(1);
  const job = (await NotificationJob.findOne())!;
  expect((await saasReminderEligibility(job, now)).eligible).toBe(true);
  await Subscription.updateOne({ _id: sub._id }, { $set: { periodEnd: new Date(+now + 30 * dayMs) } });
  expect((await saasReminderEligibility(job, now)).eligible).toBe(false);
  await Subscription.updateOne({ _id: sub._id }, { $set: { periodEnd: new Date(+now + 3 * dayMs) } });
  await TelegramIntegration.updateOne({ _id: link._id }, { $set: { "notificationPreferences.enabled": false } });
  expect((await saasReminderEligibility(job, now)).eligible).toBe(false);
});

it("delivers through the existing durable leased dispatcher exactly once", async () => {
  const now = new Date();
  await subscription(new Date(+now + dayMs));
  await integration();
  await NotificationSettings.create({ tenantId, quietStart: "00:00", quietEnd: "00:00" });
  await planSaasReminders(now);
  const send = vi.fn().mockResolvedValue({});
  expect(await processNotification(config, send, now)).toBe(true);
  await TelegramDispatch.deleteMany({});
  expect(await processNotification(config, send, now)).toBe(false);
  expect(send).toHaveBeenCalledOnce();
  expect((await NotificationJob.findOne())?.status).toBe("sent");
});
