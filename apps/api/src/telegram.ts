import { guardianCommand } from "./guardian-webhook.js";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import mongoose from "mongoose";
import { Router } from "express";
import { z } from "zod";
import type { Config } from "./config.js";
import { AppError } from "./errors.js";
import { principal, requireRoles, tenantScope } from "./security.js";
import { Tenant, User } from "./models.js";
import {
  TelegramIntegration as Integration,
  TelegramUpdate,
} from "./telegram-models.js";
export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export function newLinkToken() {
  return randomBytes(32).toString("base64url");
}
export function validSecret(actual: string | undefined, expected: string) {
  return (
    !!actual &&
    timingSafeEqual(
      createHash("sha256").update(actual).digest(),
      createHash("sha256").update(expected).digest(),
    )
  );
}
export function telegramConfigured(config: Config) {
  return (
    !!config.TELEGRAM_BOT_TOKEN &&
    /^\d+:[\w-]+$/.test(config.TELEGRAM_BOT_TOKEN) &&
    /^[A-Za-z0-9_]{5,32}$/.test(config.TELEGRAM_BOT_USERNAME ?? "") &&
    /^[A-Za-z0-9_-]{32,256}$/.test(config.TELEGRAM_WEBHOOK_SECRET ?? "")
  );
}
const unavailable = () =>
  new AppError(
    503,
    "TELEGRAM_UNAVAILABLE",
    "Telegram integratsiyasi hozircha sozlanmagan.",
  );
export function telegramRouter(config: Config) {
  const router = Router();
  router.use(requireRoles("business_owner", "admin", "teacher"));
  const scope = (req: Express.Request) => ({
    ...tenantScope(principal(req)),
    userId: principal(req).userId,
  });
  router.get("/", async (req, res) => {
    const row = await Integration.findOne(scope(req));
    res.json({
      available: telegramConfigured(config),
      connected: row?.status === "connected",
      linkedAt: row?.linkedAt ?? null,
      notificationPreferences: {
        enabled: row?.notificationPreferences?.enabled ?? false,
      },
    });
  });
  router.post("/link", async (req, res) => {
    z.object({}).strict().parse(req.body);
    if (!telegramConfigured(config)) throw unavailable();
    const token = newLinkToken();
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    const row = await Integration.findOneAndUpdate(
      { ...scope(req), status: "disconnected" },
      { $set: { tokenHash: hashToken(token), tokenExpiresAt: expiresAt } },
      { upsert: true, new: true },
    );
    if (!row)
      throw new AppError(
        409,
        "ALREADY_LINKED",
        "Avval mavjud ulanishni uzing.",
      );
    res.status(201).json({
      link: `https://t.me/${config.TELEGRAM_BOT_USERNAME}?start=${token}`,
      expiresAt,
    });
  });
  router.post("/disconnect", async (req, res) => {
    z.object({}).strict().parse(req.body);
    await Integration.updateOne(scope(req), {
      $set: {
        status: "disconnected",
        "notificationPreferences.enabled": false,
      },
      $unset: {
        tokenHash: 1,
        tokenExpiresAt: 1,
        telegramUserId: 1,
        chatId: 1,
        linkedAt: 1,
      },
      $inc: { revision: 1 },
    });
    res.status(204).end();
  });
  router.patch("/preferences", async (req, res) => {
    const { enabled } = z
      .object({ enabled: z.boolean() })
      .strict()
      .parse(req.body);
    const result = await Integration.updateOne(
      { ...scope(req), status: "connected" },
      {
        $set: { "notificationPreferences.enabled": enabled },
        $inc: { revision: 1 },
      },
    );
    if (!result.matchedCount)
      throw new AppError(409, "NOT_LINKED", "Avval Telegramni ulang.");
    res.status(204).end();
  });
  return router;
}
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const updateSchema = z.object({
  update_id: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  message: z
    .object({
      message_id: id,
      date: z.number().int().nonnegative(),
      from: z.object({ id, is_bot: z.boolean() }),
      chat: z.object({ id: z.number().int().safe(), type: z.string() }),
      text: z.string().max(4096).optional(),
    })
    .optional(),
});
const invalidLink =
  "Ulash havolasi yaroqsiz yoki muddati tugagan. CRM orqali yangi havola oling.";
export function telegramWebhook(
  config: Config,
): import("express").RequestHandler {
  return async (req, res) => {
    if (!telegramConfigured(config)) throw unavailable();
    if (
      !validSecret(
        req.get("X-Telegram-Bot-Api-Secret-Token"),
        config.TELEGRAM_WEBHOOK_SECRET!,
      )
    )
      throw new AppError(401, "INVALID_WEBHOOK_SECRET", "Ruxsat berilmagan.");
    const update = updateSchema.parse(req.body);
    let reply: string | undefined;
    try {
      await mongoose.connection.transaction(async (session) => {
        reply = undefined;
        await TelegramUpdate.create(
          [
            {
              updateId: update.update_id,
              expiresAt: new Date(Date.now() + 7 * 86400_000),
            },
          ],
          { session },
        );
        const msg = update.message;
        // Private chats only; reject old/future commands even after receipt retention expires.
        if (
          !msg ||
          msg.from.is_bot ||
          msg.chat.type !== "private" ||
          msg.chat.id !== msg.from.id ||
          Math.abs(Date.now() / 1000 - msg.date) > 600
        )
          return;
        const telegramUserId = String(msg.from.id);
        const [command, token] = (msg.text ?? "").trim().split(/\s+/);
        const cmd = command?.split("@")[0];
        const guardianReply = await guardianCommand(
          cmd,
          token,
          telegramUserId,
          session,
        );
        if (guardianReply !== undefined) {
          reply = guardianReply;
          return;
        }
        if (cmd === "/start" && token) {
          reply = invalidLink;
          if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return;
          const row = await Integration.findOne({
            tokenHash: hashToken(token),
            tokenExpiresAt: { $gt: new Date() },
            status: "disconnected",
          }).session(session);
          if (!row) return;
          const user = await User.findOne({
            _id: row.userId,
            tenantId: row.tenantId,
            active: true,
            role: { $in: ["business_owner", "admin", "teacher"] },
          }).session(session);
          if (
            !user ||
            !(await Tenant.exists({ _id: row.tenantId, active: true }).session(
              session,
            ))
          )
            return;
          if (
            await Integration.exists({
              telegramUserId,
              status: "connected",
            }).session(session)
          ) {
            reply =
              "Telegram boshqa hisobga ulangan. Avval CRM orqali ulanishni uzing.";
            return;
          }
          const result = await Integration.updateOne(
            {
              _id: row._id,
              status: "disconnected",
              tokenHash: hashToken(token),
              tokenExpiresAt: { $gt: new Date() },
            },
            {
              $set: {
                status: "connected",
                telegramUserId,
                chatId: String(msg.chat.id),
                linkedAt: new Date(),
                "notificationPreferences.enabled": true,
              },
              $unset: { tokenHash: 1, tokenExpiresAt: 1 },
              $inc: { revision: 1 },
            },
            { session },
          );
          if (result.modifiedCount)
            reply =
              "Telegram hisobingiz muvaffaqiyatli ulandi. Sozlamalarni CRM orqali boshqaring.";
        } else if (cmd === "/stop") {
          await Integration.updateOne(
            { telegramUserId, status: "connected" },
            {
              $set: { "notificationPreferences.enabled": false },
              $inc: { revision: 1 },
            },
            { session },
          );
          reply =
            "Bildirishnomalar o‘chirildi. Qayta yoqish uchun CRM sozlamalarini oching.";
        } else if (cmd === "/status") {
          const row = await Integration.findOne({
            telegramUserId,
            status: "connected",
          }).session(session);
          reply = row
            ? `Hisob ulangan. Bildirishnomalar: ${row.notificationPreferences?.enabled ? "yoqilgan" : "o‘chirilgan"}.`
            : "Hisob ulanmagan. CRM → Sozlamalar → Telegram orqali ulang.";
        } else {
          reply =
            "SoftLans Edu botiga xush kelibsiz!\n/start — hisobni ulash\n/help — yordam\n/status — ulanish holati\n/stop — bildirishnomalarni o‘chirish\nHisobni ulash uchun CRM → Sozlamalar → Telegram bo‘limini oching.";
        }
      });
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      // A committed receipt means this update was already handled. Other uniqueness races retry safely.
      if (!(await TelegramUpdate.exists({ updateId: update.update_id })))
        throw new AppError(503, "RETRY_UPDATE", "Qayta urinib ko‘ring.");
      reply = undefined;
    }
    res.json(
      reply && update.message
        ? {
            method: "sendMessage",
            chat_id: update.message.chat.id,
            text: reply,
          }
        : { ok: true },
    );
  };
}
