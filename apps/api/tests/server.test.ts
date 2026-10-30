import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";

const mocks = vi.hoisted(() => ({
  createApp: vi.fn(),
  registerWebhook: vi.fn(),
  open: vi.fn(),
  verify: vi.fn(),
  indexes: vi.fn(),
  listen: vi.fn(),
  disconnect: vi.fn(),
}));
vi.mock("../src/telegram-webhook-registration.js", () => ({
  registerTelegramWebhook: mocks.registerWebhook,
}));
vi.mock("../src/app.js", () => ({ createApp: mocks.createApp }));
vi.mock("../src/models.js", () => ({ ensureIndexes: mocks.indexes }));
vi.mock("../src/db.js", async (original) => ({
  ...(await original<typeof import("../src/db.js")>()),
  openDatabaseConnection: mocks.open,
  verifyReplicaSet: mocks.verify,
}));
vi.mock("mongoose", async (original) => {
  const module = await original<typeof import("mongoose")>();
  return {
    ...module,
    default: { ...module.default, disconnect: mocks.disconnect },
  };
});

let server: EventEmitter;
let exitCode: typeof process.exitCode;
let errors: ReturnType<typeof vi.spyOn>;
let information: ReturnType<typeof vi.spyOn>;
let secret: string;
let uri: string;
let listeners: Record<string, ReturnType<typeof process.listeners>>;
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  exitCode = process.exitCode;
  secret = randomBytes(48).toString("hex");
  uri = `mongodb+srv://fixture:${secret}@private.example.test/demo`;
  const env = {
    NODE_ENV: "production",
    PORT: "10000",
    APP_ORIGIN: "https://demo.example.test",
    MONGODB_URI: uri,
    JWT_SECRET: secret,
    TRUST_PROXY_HOPS: "1",
    DEMO_MODE: "true",
    PUBLIC_REGISTRATION_ENABLED: "false",
  };
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
  information = vi.spyOn(console, "info").mockImplementation(() => {});
  listeners = {
    SIGTERM: process.listeners("SIGTERM"),
    SIGINT: process.listeners("SIGINT"),
  };
  server = new EventEmitter();
  mocks.createApp.mockReturnValue({ listen: mocks.listen });
  mocks.open.mockResolvedValue(undefined);
  mocks.verify.mockResolvedValue(undefined);
  mocks.indexes.mockResolvedValue(undefined);
  mocks.disconnect.mockResolvedValue(undefined);
  mocks.listen.mockImplementation(() => {
    queueMicrotask(() => server.emit("listening"));
    return server;
  });
});
afterEach(() => {
  process.exitCode = exitCode;
  for (const signal of ["SIGTERM", "SIGINT"]) {
    for (const listener of process.listeners(signal))
      if (!listeners[signal]!.includes(listener))
        process.removeListener(signal, listener);
  }
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
function diagnostic() {
  expect(errors).toHaveBeenCalledTimes(1);
  expect(errors.mock.calls[0]).toHaveLength(1);
  const serialized = errors.mock.calls[0]![0] as string;
  expect(serialized).not.toContain(secret);
  expect(serialized).not.toContain(uri);
  expect(serialized).not.toContain("private.example.test");
  expect(process.exitCode).toBe(1);
  expect(information).not.toHaveBeenCalled();
  expect(mocks.disconnect).toHaveBeenCalledOnce();
  expect(mocks.registerWebhook).not.toHaveBeenCalled();
  return JSON.parse(serialized);
}

describe("server startup failure logging", () => {
  it("logs invalid config field names without values and never connects", async () => {
    vi.stubEnv("JWT_SECRET", "invalid-sensitive-secret");
    await import("../src/server.js");
    expect(diagnostic()).toEqual({
      event: "startup_failed",
      stage: "configuration",
      category: "invalid_configuration",
      fields: ["JWT_SECRET"],
    });
    expect(errors.mock.calls[0]![0]).not.toContain("invalid-sensitive-secret");
    expect(mocks.createApp).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it("logs application initialization failures before opening the database", async () => {
    mocks.createApp.mockImplementation(() => {
      throw new Error(uri);
    });
    await import("../src/server.js");
    expect(diagnostic()).toEqual({
      event: "startup_failed",
      stage: "application",
      category: "application_initialization_failed",
    });
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it("logs connection failures without running replica checks, indexes or listen", async () => {
    mocks.open.mockRejectedValue(Object.assign(new Error(uri), { code: 18 }));
    await import("../src/server.js");
    expect(diagnostic()).toEqual({
      event: "startup_failed",
      stage: "mongodb_connection",
      category: "authentication_failed",
    });
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.indexes).not.toHaveBeenCalled();
    expect(mocks.listen).not.toHaveBeenCalled();
  });
  it("logs missing replica-set support separately and never initializes indexes", async () => {
    const { ReplicaSetRequiredError } = await import("../src/db.js");
    mocks.verify.mockRejectedValue(new ReplicaSetRequiredError());
    await import("../src/server.js");
    expect(diagnostic()).toEqual({
      event: "startup_failed",
      stage: "replica_set",
      category: "replica_set_required",
    });
    expect(mocks.indexes).not.toHaveBeenCalled();
    expect(mocks.listen).not.toHaveBeenCalled();
  });
  it("logs hello command failures separately from unsupported topology", async () => {
    mocks.verify.mockRejectedValue(Object.assign(new Error(uri), { code: 13 }));
    await import("../src/server.js");
    expect(diagnostic()).toEqual({
      event: "startup_failed",
      stage: "replica_set",
      category: "database_permission_denied",
    });
    expect(mocks.indexes).not.toHaveBeenCalled();
  });
  it("logs index failures without leaking duplicate values or starting HTTP", async () => {
    mocks.indexes.mockRejectedValue(
      Object.assign(new Error(uri), {
        code: 11000,
        keyValue: { email: secret },
        stack: uri,
      }),
    );
    await import("../src/server.js");
    expect(diagnostic()).toEqual({
      event: "startup_failed",
      stage: "index_initialization",
      category: "duplicate_key",
    });
    expect(mocks.listen).not.toHaveBeenCalled();
  });
  it("catches asynchronous port binding errors through the same safe logger", async () => {
    mocks.listen.mockImplementation(() => {
      queueMicrotask(() =>
        server.emit(
          "error",
          Object.assign(new Error(uri), { code: "EADDRINUSE" }),
        ),
      );
      return server;
    });
    await import("../src/server.js");
    expect(diagnostic()).toEqual({
      event: "startup_failed",
      stage: "listen",
      category: "port_in_use",
    });
  });
  it("keeps the original failure visible even when disconnect also fails", async () => {
    mocks.open.mockRejectedValue(new Error(uri));
    mocks.disconnect.mockRejectedValue(new Error(secret));
    await import("../src/server.js");
    expect(process.exitCode).toBe(1);
    expect(errors.mock.calls).toEqual([
      [
        JSON.stringify({
          event: "startup_failed",
          stage: "mongodb_connection",
          category: "database_connection_failed",
        }),
      ],
      [
        JSON.stringify({
          event: "startup_cleanup_failed",
          stage: "cleanup",
          category: "database_disconnect_failed",
        }),
      ],
    ]);
  });
  it("continues startup without waiting for Telegram", async () => {
    mocks.registerWebhook.mockReturnValue(new Promise(() => {}));
    await import("../src/server.js");
    expect(mocks.registerWebhook).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(exitCode);
    expect(mocks.disconnect).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    expect(process.listenerCount("SIGTERM")).toBeGreaterThan(
      listeners.SIGTERM!.length,
    );
  });
  it("runs every prerequisite in order and logs listening only after binding", async () => {
    await import("../src/server.js");
    expect(errors).not.toHaveBeenCalled();
    expect(mocks.disconnect).not.toHaveBeenCalled();
    expect(mocks.listen).toHaveBeenCalledWith(10000, "0.0.0.0");
    const calls = [
      mocks.createApp,
      mocks.open,
      mocks.verify,
      mocks.indexes,
      mocks.listen,
      information,
    ].map((mock) => mock.mock.invocationCallOrder[0]);
    expect(calls).toEqual([...calls].sort((a, b) => a! - b!));
    expect(information).toHaveBeenCalledWith("API listening on port 10000");
    expect(process.exitCode).toBe(exitCode);
    expect(server.listenerCount("error")).toBe(0);
    expect(mocks.registerWebhook).toHaveBeenCalledOnce();
    expect(mocks.registerWebhook.mock.invocationCallOrder[0]).toBeGreaterThan(
      information.mock.invocationCallOrder[0]!,
    );
  });
});
