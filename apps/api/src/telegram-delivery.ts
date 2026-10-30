import { Api, GrammyError } from "grammy";
import { randomUUID } from "node:crypto";
import { Types } from "mongoose";
import type { Config } from "./config.js";
import { Tenant, User } from "./models.js";
import {
  TelegramIntegration as Integration,
  TelegramDelivery as Delivery,
  TelegramDispatch,
} from "./telegram-models.js";
import { telegramConfigured } from "./telegram.js";
export type SendTelegram = (chatId: string, text: string) => Promise<unknown>;
// Internal service only. No HTTP bulk-message endpoint or automated producers in Phase 5.1.
export async function enqueueTelegram(input: {
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  idempotencyKey: string;
  text: string;
}) {
  if (
    !input.idempotencyKey ||
    input.idempotencyKey.length > 160 ||
    !input.text ||
    input.text.length > 4096
  )
    throw new Error("Invalid notification");
  const row = await Integration.findOne({
    tenantId: input.tenantId,
    userId: input.userId,
    status: "connected",
    "notificationPreferences.enabled": true,
  });
  if (!row) throw new Error("Recipient unavailable");
  try {
    return await Delivery.findOneAndUpdate(
      { tenantId: input.tenantId, idempotencyKey: input.idempotencyKey },
      {
        $setOnInsert: {
          ...input,
          integrationId: row._id,
          integrationRevision: row.revision,
        },
      },
      { upsert: true, new: true },
    );
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    return Delivery.findOne({
      tenantId: input.tenantId,
      idempotencyKey: input.idempotencyKey,
    });
  }
}
export function retryDelay(attempt: number, retryAfter = 0) {
  return (
    Math.max(
      Math.min(3600, 5 * 2 ** Math.min(attempt, 10)),
      Math.min(86400, Math.max(0, retryAfter)),
    ) * 1000
  );
}
export async function dispatchTelegram(config: Config, send?: SendTelegram) {
  if (!telegramConfigured(config)) return false;
  const now = new Date();
  await Integration.updateMany(
    { tokenExpiresAt: { $lte: now } },
    { $unset: { tokenHash: 1, tokenExpiresAt: 1 } },
  );
  // Expired leases have an unknown API outcome: do not automatically duplicate a possibly delivered message.
  await Delivery.updateMany(
    { status: "sending", leaseUntil: { $lte: now } },
    {
      $set: { status: "failed", errorCode: "UNKNOWN_OUTCOME" },
      $unset: { text: 1 },
    },
  );
  await TelegramDispatch.updateOne(
    { _id: "bot" },
    { $setOnInsert: { availableAt: now } },
    { upsert: true },
  );
  const permit = await TelegramDispatch.findOneAndUpdate(
    { _id: "bot", availableAt: { $lte: now } },
    { $set: { availableAt: new Date(now.getTime() + 60_000) } },
  );
  if (!permit) return false;
  const leaseId = randomUUID();
  const job = await Delivery.findOneAndUpdate(
    { status: "pending", nextAttemptAt: { $lte: now }, attempts: { $lt: 5 } },
    {
      $set: {
        status: "sending",
        leaseId,
        leaseUntil: new Date(now.getTime() + 60_000),
      },
      $inc: { attempts: 1 },
    },
    { new: true, sort: { nextAttemptAt: 1 } },
  ).select("+text");
  if (!job) {
    await TelegramDispatch.updateOne(
      { _id: "bot" },
      { $set: { availableAt: new Date(Date.now() + 1100) } },
    );
    return false;
  }
  const finish = async (values: object, terminal = true) =>
    Delivery.updateOne(
      { _id: job._id, status: "sending", leaseId },
      {
        $set: values,
        $unset: { leaseId: 1, leaseUntil: 1, ...(terminal ? { text: 1 } : {}) },
      },
    );
  const row = await Integration.findOne({
    _id: job.integrationId,
    tenantId: job.tenantId,
    userId: job.userId,
    revision: job.integrationRevision,
    status: "connected",
    "notificationPreferences.enabled": true,
  });
  if (
    !row?.chatId ||
    !(await Tenant.exists({ _id: job.tenantId, active: true })) ||
    !(await User.exists({
      _id: job.userId,
      tenantId: job.tenantId,
      active: true,
    }))
  ) {
    await finish({ status: "cancelled", errorCode: "RECIPIENT_UNAVAILABLE" });
    return true;
  }
  try {
    const sender =
      send ??
      ((chatId, text) =>
        new Api(config.TELEGRAM_BOT_TOKEN!, { timeoutSeconds: 10 }).sendMessage(
          chatId,
          text,
        ));
    await sender(row.chatId, job.text!);
    await finish({ status: "sent", sentAt: new Date() });
    await TelegramDispatch.updateOne(
      { _id: "bot" },
      { $set: { availableAt: new Date(Date.now() + 1100) } },
    );
  } catch (error) {
    const apiError = error instanceof GrammyError ? error : null;
    const code = apiError?.error_code;
    const retry =
      (code === 429 || (code !== undefined && code >= 500)) && job.attempts < 5;
    const delay = retryDelay(job.attempts, apiError?.parameters.retry_after);
    await finish(
      {
        status: retry ? "pending" : "failed",
        errorCode: code ? `TELEGRAM_${code}` : "UNKNOWN_OUTCOME",
        nextAttemptAt: new Date(Date.now() + delay),
      },
      !retry,
    );
    if (code === 403)
      await Integration.updateOne(
        { _id: row._id, revision: row.revision },
        {
          $set: { "notificationPreferences.enabled": false },
          $inc: { revision: 1 },
        },
      );
    await TelegramDispatch.updateOne(
      { _id: "bot" },
      {
        $set: {
          availableAt: new Date(Date.now() + (code === 429 ? delay : 1100)),
        },
      },
    );
  }
  return true;
}
