import mongoose from "mongoose";
import { parseConfig } from "../config.js";
import { connectDatabase } from "../db.js";
import { ensureIndexes } from "../models.js";
import { runNotificationAutomation } from "../notification-automation.js";
let stage = "configuration";
try {
  const config = parseConfig(process.env);
  stage = "database";
  await connectDatabase(config.MONGODB_URI);
  stage = "indexes";
  await ensureIndexes();
  stage = "automation";
  if (!(await runNotificationAutomation(config))) process.exitCode = 1;
} catch {
  console.error(
    JSON.stringify({
      event: "notification_processor",
      stage,
      code: "RUN_FAILED",
    }),
  );
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
