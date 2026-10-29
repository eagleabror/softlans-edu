import mongoose from "mongoose";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { parseConfig } from "./config.js";
import { connectDatabase } from "./db.js";
import { ensureIndexes } from "./models.js";

try {
  const config = parseConfig(process.env);
  // tsc emits this module at apps/api/dist/apps/api/src/server.js.
  const app = createApp(
    config,
    config.NODE_ENV === "production"
      ? {
          frontendDist: fileURLToPath(
            new URL("../../../../../web/dist/", import.meta.url),
          ),
        }
      : {},
  );
  await connectDatabase(config.MONGODB_URI);
  await ensureIndexes();
  const server = app.listen(config.PORT, "0.0.0.0", () =>
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
    "API startup failed. Verify environment configuration, frontend build, MongoDB replica set and indexes.",
  );
  await mongoose.disconnect();
  process.exitCode = 1;
}
