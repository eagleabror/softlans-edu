import express, { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Config } from "./config.js";
import { AppError } from "./errors.js";
import { validSecret, telegramConfigured } from "./telegram.js";
import { NotificationSchedulerLease } from "./notification-models.js";
import { runNotificationAutomation } from "./notification-automation.js";
const event = (status: string, code?: string) =>
  console.info(
    JSON.stringify({
      event: "notification_scheduler",
      status,
      ...(code ? { code } : {}),
    }),
  );
export function notificationScheduler(config: Config) {
  const router = Router();
  router.post(
    "/run",
    (req, _res, next) => {
      if (!config.NOTIFICATION_SCHEDULER_SECRET)
        throw new AppError(
          503,
          "SCHEDULER_DISABLED",
          "Scheduler is not configured.",
        );
      // Query strings, CRM cookies and the bot webhook secret never authorize this route.
      const header = req.get("Authorization");
      if (
        !header?.startsWith("Bearer ") ||
        !validSecret(header.slice(7), config.NOTIFICATION_SCHEDULER_SECRET)
      )
        throw new AppError(401, "SCHEDULER_UNAUTHORIZED", "Unauthorized.");
      next();
    },
    rateLimit({
      windowMs: 60000,
      limit: 10,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
    express.json({ limit: "1kb", strict: true }),
    async (req, res) => {
      z.object({}).strict().parse(req.query);
      z.object({})
        .strict()
        .parse(req.body ?? {});
      if (!telegramConfigured(config))
        throw new AppError(
          503,
          "TELEGRAM_UNAVAILABLE",
          "Telegram is not configured.",
        );
      // Persist admission pacing across restarts and multiple API instances.
      await NotificationSchedulerLease.updateOne(
        { _id: "http" },
        {
          $setOnInsert: { leaseUntil: new Date(0), nextAllowedAt: new Date(0) },
        },
        { upsert: true },
      ).catch((e) => {
        if (e.code !== 11000) throw e;
      });
      const now = new Date(),
        leaseId = randomUUID();
      const lease = await NotificationSchedulerLease.findOneAndUpdate(
        {
          _id: "http",
          leaseUntil: { $lte: now },
          nextAllowedAt: { $lte: now },
        },
        {
          $set: {
            leaseId,
            leaseUntil: new Date(now.getTime() + 5 * 60000),
            nextAllowedAt: new Date(now.getTime() + 60000),
          },
        },
      );
      if (!lease) {
        res.status(202).json({ status: "already_running_or_rate_limited" });
        return;
      }
      event("accepted");
      // Acknowledge promptly: external free schedulers typically time out at 30s.
      // The jobs remain durable if this web process restarts after acknowledgement.
      res.status(202).json({ status: "accepted" });
      void (async () => {
        try {
          const ok = await runNotificationAutomation(config);
          event(ok ? "completed" : "failed", ok ? undefined : "BATCH_FAILED");
        } catch {
          event("failed", "BATCH_FAILED");
        } finally {
          try {
            await NotificationSchedulerLease.updateOne(
              { _id: "http", leaseId },
              { $set: { leaseUntil: new Date(0) }, $unset: { leaseId: 1 } },
            );
          } catch {
            event("failed", "LEASE_RELEASE_FAILED");
          }
        }
      })();
    },
  );
  return router;
}
