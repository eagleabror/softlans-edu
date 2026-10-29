import { ConfigurationError, configurationFields } from "./config.js";
import { ReplicaSetRequiredError } from "./db.js";

export type StartupStage =
  | "configuration"
  | "application"
  | "mongodb_connection"
  | "replica_set"
  | "index_initialization"
  | "listen"
  | "cleanup";

// Match only known driver/OS identifiers. Never output error messages, stacks,
// raw names/codes, topology descriptions, causes, index values or environment.
function databaseCategory(error: unknown): string | undefined {
  const chain: Record<string, unknown>[] = [];
  let current = error;
  while (current && typeof current === "object" && chain.length < 4) {
    const entry = current as Record<string, unknown>;
    if (chain.includes(entry)) break;
    chain.push(entry);
    current = entry.cause;
  }
  for (const entry of chain) {
    const code = typeof entry.code === "string" ? entry.code : "";
    if (entry.code === 18) return "authentication_failed";
    if (entry.code === 13) return "database_permission_denied";
    if (entry.code === 11000) return "duplicate_key";
    if (entry.code === 85 || entry.code === 86) return "index_conflict";
    if (["ENOTFOUND", "EAI_AGAIN", "ENODATA", "ESERVFAIL"].includes(code))
      return "dns_resolution_failed";
    if (
      ["ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH"].includes(
        code,
      )
    )
      return "network_connection_failed";
    if (entry.code === "ETIMEDOUT") return "network_timeout";
    if (
      [
        "CERT_HAS_EXPIRED",
        "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
        "SELF_SIGNED_CERT_IN_CHAIN",
        "DEPTH_ZERO_SELF_SIGNED_CERT",
        "ERR_TLS_CERT_ALTNAME_INVALID",
      ].includes(code)
    )
      return "tls_connection_failed";
    if (entry.name === "MongoParseError") return "invalid_database_uri";
  }
  for (const entry of chain) {
    const name = typeof entry.name === "string" ? entry.name : "";
    if (
      ["MongoServerSelectionError", "MongooseServerSelectionError"].includes(
        name,
      )
    )
      return "server_selection_failed";
    if (entry.name === "MongoNetworkTimeoutError") return "network_timeout";
    if (entry.name === "MongoNetworkError") return "network_connection_failed";
  }
  return undefined;
}

function buildDiagnostic(stage: StartupStage, error: unknown) {
  const base = { event: "startup_failed", stage };
  switch (stage) {
    case "configuration":
      return {
        ...base,
        category: "invalid_configuration",
        ...(error instanceof ConfigurationError
          ? {
              fields: configurationFields.filter((field) =>
                error.fields.includes(field),
              ),
            }
          : {}),
      };
    case "application":
      return { ...base, category: "application_initialization_failed" };
    case "mongodb_connection":
      return {
        ...base,
        category: databaseCategory(error) ?? "database_connection_failed",
      };
    case "replica_set":
      return {
        ...base,
        category:
          error instanceof ReplicaSetRequiredError
            ? "replica_set_required"
            : (databaseCategory(error) ?? "replica_set_check_failed"),
      };
    case "index_initialization":
      return {
        ...base,
        category: databaseCategory(error) ?? "index_initialization_failed",
      };
    case "listen": {
      const code =
        error && typeof error === "object" && "code" in error
          ? error.code
          : undefined;
      return {
        ...base,
        category:
          code === "EADDRINUSE"
            ? "port_in_use"
            : code === "EACCES"
              ? "listen_permission_denied"
              : "listen_failed",
      };
    }
    case "cleanup":
      return {
        event: "startup_cleanup_failed",
        stage,
        category: "database_disconnect_failed",
      };
  }
}

export function startupDiagnostic(stage: StartupStage, error: unknown) {
  try {
    return buildDiagnostic(stage, error);
  } catch {
    // Even an unreadable error property must not cause an uncaught raw error.
    return buildDiagnostic(stage, undefined);
  }
}
