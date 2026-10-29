import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { ConfigurationError, parseConfig } from "../src/config.js";
import { ReplicaSetRequiredError } from "../src/db.js";
import {
  startupDiagnostic,
  type StartupStage,
} from "../src/startup-diagnostics.js";

describe("safe startup diagnostic categories", () => {
  it.each([
    [{ code: 18 }, "authentication_failed"],
    [{ code: 13 }, "database_permission_denied"],
    [{ code: 11000 }, "duplicate_key"],
    [{ code: 85 }, "index_conflict"],
    [{ code: 86 }, "index_conflict"],
    [{ code: "ENOTFOUND" }, "dns_resolution_failed"],
    [{ code: "EAI_AGAIN" }, "dns_resolution_failed"],
    [{ code: "ECONNREFUSED" }, "network_connection_failed"],
    [{ code: "ETIMEDOUT" }, "network_timeout"],
    [{ code: "CERT_HAS_EXPIRED" }, "tls_connection_failed"],
    [{ name: "MongoParseError" }, "invalid_database_uri"],
    [{ name: "MongooseServerSelectionError" }, "server_selection_failed"],
    [{ name: "MongoServerSelectionError" }, "server_selection_failed"],
    [{ name: "MongoNetworkError" }, "network_connection_failed"],
    [{ name: "MongoNetworkTimeoutError" }, "network_timeout"],
    [
      { name: "MongoServerSelectionError", cause: { code: "ENOTFOUND" } },
      "dns_resolution_failed",
    ],
  ])("maps known identifiers to fixed categories: %j", (error, category) => {
    expect(startupDiagnostic("mongodb_connection", error)).toEqual({
      event: "startup_failed",
      stage: "mongodb_connection",
      category,
    });
  });
  it("distinguishes unsupported topology from a failed topology check", () => {
    expect(
      startupDiagnostic("replica_set", new ReplicaSetRequiredError()).category,
    ).toBe("replica_set_required");
    expect(startupDiagnostic("replica_set", new Error()).category).toBe(
      "replica_set_check_failed",
    );
    expect(startupDiagnostic("replica_set", { code: 13 }).category).toBe(
      "database_permission_denied",
    );
  });
  it("reports only allowlisted invalid configuration field names", () => {
    const secret = randomBytes(16).toString("hex");
    try {
      parseConfig({
        NODE_ENV: "production",
        APP_ORIGIN: "http://invalid.test",
        MONGODB_URI: secret,
        JWT_SECRET: secret,
      });
      throw new Error("Expected validation failure");
    } catch (error) {
      const diagnostic = startupDiagnostic("configuration", error);
      expect(diagnostic).toEqual({
        event: "startup_failed",
        stage: "configuration",
        category: "invalid_configuration",
        fields: ["APP_ORIGIN", "MONGODB_URI", "JWT_SECRET"],
      });
      expect(JSON.stringify(diagnostic)).not.toContain(secret);
    }
    expect(
      startupDiagnostic(
        "configuration",
        new ConfigurationError(["PORT", secret]),
      ),
    ).toEqual({
      event: "startup_failed",
      stage: "configuration",
      category: "invalid_configuration",
      fields: ["PORT"],
    });
  });
  it.each([
    ["configuration", "invalid_configuration"],
    ["application", "application_initialization_failed"],
    ["mongodb_connection", "database_connection_failed"],
    ["replica_set", "replica_set_check_failed"],
    ["index_initialization", "index_initialization_failed"],
    ["listen", "listen_failed"],
    ["cleanup", "database_disconnect_failed"],
  ] as const)(
    "never serializes raw error data for %s",
    (stage: StartupStage, category) => {
      const secret = randomBytes(48).toString("hex");
      const uri = `mongodb+srv://fixture:${secret}@private.example.test/demo`;
      const error = Object.assign(new Error(uri), {
        name: secret,
        code: secret,
        stack: secret,
        cause: { message: uri },
        reason: { servers: uri },
        keyValue: { email: secret },
        toJSON: () => {
          throw new Error(secret);
        },
      });
      const diagnostic = startupDiagnostic(stage, error);
      expect(diagnostic).toEqual({
        event:
          stage === "cleanup" ? "startup_cleanup_failed" : "startup_failed",
        stage,
        category,
      });
      expect(JSON.stringify(diagnostic)).not.toContain(secret);
      expect(JSON.stringify(diagnostic)).not.toContain(uri);
      expect(JSON.stringify(diagnostic)).not.toContain("private.example.test");
    },
  );
  it("handles primitive errors and circular causes without serializing them", () => {
    const cyclic: { cause?: unknown } = {};
    cyclic.cause = cyclic;
    for (const error of [cyclic, undefined, null, "sensitive raw error", 123])
      expect(startupDiagnostic("mongodb_connection", error).category).toBe(
        "database_connection_failed",
      );
  });
  it("falls back safely when error metadata access itself throws", () => {
    const secret = randomBytes(48).toString("hex");
    const error = new Proxy(
      {},
      {
        get() {
          throw new Error(secret);
        },
        getPrototypeOf() {
          throw new Error(secret);
        },
      },
    );
    for (const stage of [
      "configuration",
      "mongodb_connection",
      "replica_set",
      "listen",
    ] as const) {
      const serialized = JSON.stringify(startupDiagnostic(stage, error));
      expect(serialized).not.toContain(secret);
      expect(JSON.parse(serialized).stage).toBe(stage);
    }
  });
  it.each([
    ["EADDRINUSE", "port_in_use"],
    ["EACCES", "listen_permission_denied"],
  ])("categorizes listener errors: %s", (code, category) => {
    expect(startupDiagnostic("listen", { code }).category).toBe(category);
  });
});
