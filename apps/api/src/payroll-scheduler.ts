import express, { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { billingMonth } from "./billing-validation.js";
import type { Config } from "./config.js";
import { AppError } from "./errors.js";
import { validSecret } from "./telegram.js";
import { runPayrollScheduler, payrollCursor } from "./payroll-automation.js";
export function payrollScheduler(config: Config) {
  const router = Router();
  router.post(
    "/run",
    (req, _res, next) => {
      if (!config.PAYROLL_SCHEDULER_SECRET)
        throw new AppError(
          503,
          "SCHEDULER_DISABLED",
          "Maosh scheduleri sozlanmagan.",
        );
      const header = req.get("Authorization");
      if (
        !header?.startsWith("Bearer ") ||
        !validSecret(header.slice(7), config.PAYROLL_SCHEDULER_SECRET)
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
          dryRun: z.boolean().default(true),
          month: billingMonth.optional(),
          cursor: payrollCursor.optional(),
        })
        .strict()
        .parse(req.body ?? {});
      res.json(await runPayrollScheduler(config, input));
    },
  );
  return router;
}
