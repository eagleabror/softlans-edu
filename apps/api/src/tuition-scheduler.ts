import express, { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { Config } from "./config.js";
import { AppError } from "./errors.js";
import { validSecret } from "./telegram.js";
import { TuitionRun } from "./tuition-run-model.js";
import { principal, requireRoles, tenantScope } from "./security.js";
import { billingMonth } from "./billing-validation.js";
import { runTuitionBatch } from "./tuition-service.js";
export function tuitionScheduler(config: Config) {
  const router = Router();
  router.post(
    "/run",
    (req, _res, next) => {
      if (!config.BILLING_SCHEDULER_SECRET)
        throw new AppError(
          503,
          "SCHEDULER_DISABLED",
          "Billing scheduler sozlanmagan.",
        );
      const header = req.get("Authorization");
      if (
        !header?.startsWith("Bearer ") ||
        !validSecret(header.slice(7), config.BILLING_SCHEDULER_SECRET)
      )
        throw new AppError(401, "SCHEDULER_UNAUTHORIZED", "Ruxsat yo‘q.");
      next();
    },
    rateLimit({
      windowMs: 60_000,
      limit: 10,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
    express.json({ limit: "1kb", strict: true }),
    async (req, res) => {
      z.object({}).strict().parse(req.query);
      const input = z
        .object({
          dryRun: z.boolean().default(false),
          after: z
            .string()
            .regex(/^[a-f\d]{24}$/i)
            .optional(),
        })
        .strict()
        .parse(req.body ?? {});
      if (!input.dryRun && !config.BILLING_SCHEDULER_ENABLED)
        throw new AppError(503, "SCHEDULER_DISABLED", "Avtomatik hisoblash o‘chirilgan.");
      res.json(await runTuitionBatch(input.after, new Date(), input.dryRun));
    },
  );
  return router;
}

export function tuitionAutomation(config: Config) {
  const router = Router();
  router.use(requireRoles("business_owner", "admin"));
  router.get("/", async (req, res) => {
    const q = z.object({
      month: billingMonth.optional(),
      page: z.coerce.number().int().min(1).max(10000).default(1),
    }).strict().parse(req.query);
    const filter = { ...tenantScope(principal(req)), ...(q.month ? { month: q.month } : {}) };
    const [runs, total] = await Promise.all([
      TuitionRun.find(filter).sort({ startedAt: -1, _id: -1 }).skip((q.page - 1) * 20).limit(20),
      TuitionRun.countDocuments(filter),
    ]);
    res.json({
      schedulerEnabled: config.BILLING_SCHEDULER_ENABLED && !!config.BILLING_SCHEDULER_SECRET,
      timezone: "Asia/Tashkent", page: q.page, pageSize: 20, total,
      runs: runs.map(r => ({
        id: String(r._id), month: r.month, status: r.status,
        startedAt: r.startedAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null,
        created: r.created, skipped: r.skipped, amount: r.amount, errorCode: r.errorCode ?? null,
      })),
    });
  });
  return router;
}
