import mongoose from "mongoose";
import { parseConfig } from "../config.js";
import { connectDatabase } from "../db.js";
import { ensureIndexes } from "../models.js";
import { runTuitionBatch } from "../tuition-service.js";
try {
  const args = process.argv.slice(2);
  if (args.some(a => a !== "--dry-run")) throw new Error("INVALID_ARGUMENT");
  const dryRun = args.includes("--dry-run");
  const config = parseConfig(process.env);
  if (!dryRun && !config.BILLING_SCHEDULER_ENABLED) throw new Error("SCHEDULER_DISABLED");
  await connectDatabase(config.MONGODB_URI);
  if (!dryRun) await ensureIndexes();
  let after: string | undefined;
  do {
    const result = await runTuitionBatch(after, new Date(), dryRun);
    console.info(JSON.stringify({ event: "tuition_billing", ...result }));
    after = result.nextCursor ?? undefined;
  } while (after);
} catch {
  console.error(
    JSON.stringify({ event: "tuition_billing", code: "RUN_FAILED" }),
  );
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
