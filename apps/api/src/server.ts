import mongoose from "mongoose";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import { createApp } from "./app.js";
import { parseConfig } from "./config.js";
import { openDatabaseConnection, verifyReplicaSet } from "./db.js";
import { ensureIndexes } from "./models.js";
import { startupDiagnostic, type StartupStage } from "./startup-diagnostics.js";

let stage: StartupStage = "configuration";
try {
  const config = parseConfig(process.env);
  stage = "application";
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
  stage = "mongodb_connection";
  await openDatabaseConnection(config.MONGODB_URI);
  stage = "replica_set";
  await verifyReplicaSet();
  stage = "index_initialization";
  await ensureIndexes();
  stage = "listen";
  const server = await new Promise<Server>((resolve, reject) => {
    const pending = app.listen(config.PORT, "0.0.0.0");
    pending.once("error", reject);
    pending.once("listening", () => {
      pending.off("error", reject);
      resolve(pending);
    });
  });
  console.info(`API listening on port ${config.PORT}`);
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
} catch (error) {
  console.error(JSON.stringify(startupDiagnostic(stage, error)));
  process.exitCode = 1;
  try {
    await mongoose.disconnect();
  } catch {
    console.error(JSON.stringify(startupDiagnostic("cleanup", undefined)));
  }
}
