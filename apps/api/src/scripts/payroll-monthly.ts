import mongoose from "mongoose";
import { z } from "zod";
import { parseConfig } from "../config.js";
import { connectDatabase } from "../db.js";
import { ensureIndexes } from "../models.js";
import { runPayrollScheduler, payrollCursor, assertPayrollSchedulerEnabled } from "../payroll-automation.js";
import { billingMonth } from "../billing-validation.js";
// Uses the same closing policy and durable cursor protocol as the HTTP scheduler.
// No HTTP acknowledgement can make this process exit successfully.
try {
  const config = parseConfig(process.env);
  const selectedMonth = billingMonth
    .optional()
    .parse(process.env.PAYROLL_MONTH);
  const dryRun = z.enum(["true", "false"]).default("true").parse(process.env.PAYROLL_DRY_RUN) === "true";
  assertPayrollSchedulerEnabled(config, dryRun);
  if (dryRun) mongoose.set("autoCreate", false);
  await connectDatabase(config.MONGODB_URI);
  if (!dryRun) await ensureIndexes();
  let cursor: z.infer<typeof payrollCursor> | undefined;
  let month = selectedMonth;
  let failed = false;
  do {
    const result = await runPayrollScheduler(config, { month, cursor, dryRun });
    console.info(
      JSON.stringify({
        event: "payroll_monthly",
        dryRun,
        wouldCreate: "wouldCreate" in result ? result.wouldCreate : 0,
        month: result.month,
        status: result.status,
        created: result.created,
        preserved: result.preserved,
        exceptions: result.exceptions,
      }),
    );
    failed ||= result.status === "exceptions" || result.exceptions > 0 ||
      (result.status === "processing" && "nextTeacher" in result && result.nextTeacher === null);
    month = result.month;
    cursor = result.nextCursor ?? undefined;
  } while (cursor);
  if (failed) process.exitCode = 1;
} catch {
  console.error(
    JSON.stringify({ event: "payroll_monthly", code: "RUN_FAILED" }),
  );
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
