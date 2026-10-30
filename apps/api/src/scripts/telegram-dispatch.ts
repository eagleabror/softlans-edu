import mongoose from "mongoose";
import { parseConfig } from "../config.js";
import { connectDatabase } from "../db.js";
import { dispatchTelegram } from "../telegram-delivery.js";
const config = parseConfig(process.env);
try {
  await connectDatabase(config.MONGODB_URI);
  await dispatchTelegram(config);
} finally {
  await mongoose.disconnect();
}
