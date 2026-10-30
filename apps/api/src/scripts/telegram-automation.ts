import mongoose from "mongoose";
import { setTimeout as delay } from "node:timers/promises";
import { parseConfig } from "../config.js";
import { connectDatabase } from "../db.js";
import { ensureIndexes } from "../models.js";
import { planNotifications, processNotification } from "../notifications.js";
const config = parseConfig(process.env);
try {
  await connectDatabase(config.MONGODB_URI);
  await ensureIndexes();
  await planNotifications();
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (!(await processNotification(config))) break;
    await delay(1200);
  }
} catch {
  console.error(
    "Notification processor failed; inspect safe job status records.",
  );
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
