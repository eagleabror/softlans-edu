import mongoose from "mongoose";
import { createApp } from "./app.js";
import { parseConfig } from "./config.js";
import { connectDatabase } from "./db.js";
import { ensureIndexes } from "./models.js";

try {
  const config = parseConfig(process.env);
  await connectDatabase(config.MONGODB_URI);
  await ensureIndexes();
  const server = createApp(config).listen(config.PORT, () =>
    console.info(`API listening on port ${config.PORT}`),
  );
  const shutdown = () => {
    const timeout = setTimeout(() => process.exit(1), 10_000).unref();
    server.close(() => {
      void mongoose.disconnect().finally(() => {
        clearTimeout(timeout);
        process.exit(0);
      });
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
} catch {
  console.error(
    "API startup failed. Verify environment configuration, MongoDB replica set and indexes.",
  );
  process.exitCode = 1;
}
