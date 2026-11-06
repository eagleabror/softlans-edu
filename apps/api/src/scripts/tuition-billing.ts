import mongoose from "mongoose";
import { parseConfig } from "../config.js";
import { connectDatabase } from "../db.js";
import { ensureIndexes } from "../models.js";
import { runTuitionBatch } from "../tuition-service.js";
try {
  const config = parseConfig(process.env);
  await connectDatabase(config.MONGODB_URI);
  await ensureIndexes();
  let after: string | undefined;
  do {
    const result = await runTuitionBatch(after);
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
