import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { parseConfig } from "../src/config.js";
import { connectDatabase } from "../src/db.js";
import { ensureIndexes } from "../src/models.js";
import {
  NotificationJob,
  NotificationProcessorState,
  NotificationSchedulerLease,
  OperationalAlertState,
} from "../src/notification-models.js";
import { runNotificationAutomation } from "../src/notification-automation.js";
import {
  acquireRunLease,
  releaseRunLease,
  renewRunLease,
} from "../src/notification-lease.js";
import {
  platformNotificationSnapshot,
  processorStatus,
  queueSnapshot,
} from "../src/notification-monitoring.js";
import {
  evaluateAlerts,
  sendOperatorAlert,
} from "../src/operational-alerts.js";
import { BackgroundLifecycle } from "../src/background-lifecycle.js";
const config = parseConfig({
  NODE_ENV: "test",
  APP_ORIGIN: "http://localhost:5173",
  MONGODB_URI: "mongodb://localhost/synthetic",
  JWT_SECRET: "j".repeat(48),
  TELEGRAM_BOT_TOKEN: "123:test",
  TELEGRAM_BOT_USERNAME: "test_bot",
  TELEGRAM_WEBHOOK_SECRET: "w".repeat(48),
  NOTIFICATION_SCHEDULER_SECRET: "s".repeat(48),
});
const operator = {
  ...config,
  OPERATOR_ALERTS_ENABLED: true,
  OPERATOR_TELEGRAM_BOT_TOKEN: "999:" + "a".repeat(30),
  OPERATOR_TELEGRAM_CHAT_ID: "-999",
};
const tasks = () => ({
  saas: vi.fn().mockResolvedValue(undefined),
  guardians: vi.fn().mockResolvedValue(undefined),
  owners: vi.fn().mockResolvedValue(undefined),
  process: vi.fn().mockResolvedValue(false),
  pause: vi.fn().mockResolvedValue(undefined),
  log: vi.fn(),
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
let repl: MongoMemoryReplSet;
beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: "7.0.24" },
  });
  await connectDatabase(repl.getUri("notification-reliability-synthetic"));
  await ensureIndexes();
});
beforeEach(async () => {
  for (const m of [
    NotificationJob,
    NotificationProcessorState,
    NotificationSchedulerLease,
    OperationalAlertState,
  ])
    await m.deleteMany({});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
afterAll(async () => {
  await mongoose.disconnect();
  await repl?.stop();
});
it("serializes CLI and HTTP automation, and a non-owner cannot release or renew a lease", async () => {
  const gate = deferred(),
    a = tasks(),
    b = tasks();
  a.saas.mockReturnValue(gate.promise);
  const first = runNotificationAutomation(config, a);
  await vi.waitFor(() => expect(a.saas).toHaveBeenCalledOnce());
  expect(await runNotificationAutomation(config, b)).toBe(false);
  expect(b.saas).not.toHaveBeenCalled();
  await releaseRunLease("not-owner");
  expect(await renewRunLease("not-owner")).toBe(false);
  expect(await acquireRunLease()).toBeNull();
  gate.resolve();
  expect(await first).toBe(true);
});
it("marks an aborted planning batch interrupted without processing or claiming completion", async () => {
  const gate = deferred(),
    a = tasks(),
    abort = new AbortController();
  a.saas.mockReturnValue(gate.promise);
  const run = runNotificationAutomation(config, { ...a, signal: abort.signal });
  await vi.waitFor(() => expect(a.saas).toHaveBeenCalledOnce());
  abort.abort();
  gate.resolve();
  expect(await run).toBe(false);
  const state = await NotificationProcessorState.findById("automation");
  expect(state).toMatchObject({
    stage: "interrupted",
    interruptedRuns: 1,
    consecutiveFailures: 1,
  });
  expect(state?.lastCompletedAt).toBeUndefined();
  expect(a.process).not.toHaveBeenCalled();
});
it("fences a resumed old processor after lease expiration and preserves the successor state", async () => {
  const gate = deferred(),
    a = tasks();
  a.saas.mockReturnValue(gate.promise);
  const run = runNotificationAutomation(config, a);
  await vi.waitFor(() => expect(a.saas).toHaveBeenCalledOnce());
  await NotificationSchedulerLease.updateOne(
    { _id: "automation" },
    { $set: { leaseUntil: new Date(0) } },
  );
  const successor = await acquireRunLease();
  expect(successor).toBeTruthy();
  await NotificationProcessorState.updateOne(
    {},
    { $set: { runId: "successor", stage: "delivery" } },
  );
  gate.resolve();
  expect(await run).toBe(false);
  expect(a.process).not.toHaveBeenCalled();
  expect((await NotificationProcessorState.findById("automation"))?.runId).toBe(
    "successor",
  );
  expect(
    (await NotificationSchedulerLease.findById("automation"))?.leaseId,
  ).toBe(successor);
  expect(a.log).not.toHaveBeenCalledWith(
    expect.objectContaining({ stage: "completed" }),
  );
});
it("detects a previous interrupted run after restart without losing pending or unknown jobs", async () => {
  const tenantId = new mongoose.Types.ObjectId();
  await NotificationJob.create([
    { tenantId, kind: "test", key: "pending" },
    {
      tenantId,
      kind: "test",
      key: "unknown",
      status: "failed",
      errorCode: "UNKNOWN_OUTCOME",
    },
  ]);
  await NotificationProcessorState.create({
    _id: "automation",
    runId: "dead",
    stage: "delivery",
    lastHeartbeatAt: new Date(0),
  });
  await NotificationSchedulerLease.create({
    _id: "automation",
    leaseId: "dead",
    leaseUntil: new Date(0),
  });
  expect(await runNotificationAutomation(config, tasks())).toBe(true);
  expect(
    (await NotificationProcessorState.findById("automation"))?.interruptedRuns,
  ).toBe(1);
  expect((await NotificationJob.findOne({ key: "pending" }))?.status).toBe(
    "pending",
  );
  expect((await NotificationJob.findOne({ key: "unknown" }))?.errorCode).toBe(
    "UNKNOWN_OUTCOME",
  );
});
it("renews a heartbeat during slow planning and reports freshness boundaries", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const gate = deferred(),
    a = tasks();
  a.saas.mockReturnValue(gate.promise);
  const run = runNotificationAutomation(config, a);
  await vi.waitFor(() => expect(a.saas).toHaveBeenCalledOnce());
  const prior = (await NotificationProcessorState.findById("automation"))!
    .lastHeartbeatAt!;
  // The test clock advances only after the real MongoDB calls have settled.
  await NotificationProcessorState.updateOne(
    {},
    { $set: { lastHeartbeatAt: new Date(0) } },
  );
  await vi.advanceTimersByTimeAsync(15_000);
  await vi.waitFor(async () =>
    expect(
      (await NotificationProcessorState.findById(
        "automation",
      ))!.lastHeartbeatAt!.getTime(),
    ).toBeGreaterThanOrEqual(prior.getTime()),
  );
  expect((await NotificationProcessorState.findById("automation"))?.stage).toBe(
    "planning_saas",
  );
  gate.resolve();
  expect(await run).toBe(true);
  const state = await NotificationProcessorState.findById("automation");
  expect(state!.lastHeartbeatAt!.getTime()).toBeGreaterThanOrEqual(
    prior.getTime(),
  );
  expect(
    processorStatus(
      state,
      new Date(state!.lastHeartbeatAt!.getTime() + 180000),
    ),
  ).toBe("recent");
  expect(
    processorStatus(
      state,
      new Date(state!.lastHeartbeatAt!.getTime() + 180001),
    ),
  ).toBe("stale");
});
it("deduplicates alerts across instances, caps all alert types, and consumes failed-send cooldown", async () => {
  const send = vi.fn().mockResolvedValue({});
  const now = new Date();
  await Promise.all(
    Array.from({ length: 8 }, () =>
      sendOperatorAlert(operator, "BACKLOG", send, now),
    ),
  );
  expect(send).toHaveBeenCalledOnce();
  expect(await sendOperatorAlert(operator, "SCHEDULER_STALE", send, now)).toBe(
    false,
  );
  expect(
    await sendOperatorAlert(
      operator,
      "BACKLOG",
      send,
      new Date(+now + 30 * 60000),
    ),
  ).toBe(true);
  send.mockRejectedValue(new Error("private bot token student"));
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const later = new Date(+now + 61 * 60000);
  expect(
    await sendOperatorAlert(operator, "UNKNOWN_OUTCOMES", send, later),
  ).toBe(false);
  expect(
    await sendOperatorAlert(operator, "UNKNOWN_OUTCOMES", send, later),
  ).toBe(false);
  expect(send).toHaveBeenCalledTimes(3);
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/private|student|token/);
  expect(send.mock.calls[0]).toEqual([
    "-999",
    expect.stringContaining("BACKLOG"),
  ]);
});
it("defaults to no real operator alerts, supports suppression and validates separate credentials", async () => {
  const send = vi.fn();
  expect(await sendOperatorAlert(config, "BACKLOG", send)).toBe(false);
  expect(
    await sendOperatorAlert(
      { ...operator, OPERATOR_ALERTS_SUPPRESSED: true },
      "BACKLOG",
      send,
    ),
  ).toBe(false);
  expect(await OperationalAlertState.countDocuments()).toBe(0);
  expect(send).not.toHaveBeenCalled();
  const env = {
    APP_ORIGIN: config.APP_ORIGIN,
    MONGODB_URI: config.MONGODB_URI,
    JWT_SECRET: config.JWT_SECRET,
    OPERATOR_ALERTS_ENABLED: "true",
  };
  expect(() => parseConfig(env)).toThrow("OPERATOR_ALERTS_ENABLED");
  const token = operator.OPERATOR_TELEGRAM_BOT_TOKEN;
  expect(() =>
    parseConfig({
      ...env,
      TELEGRAM_BOT_TOKEN: token,
      OPERATOR_TELEGRAM_BOT_TOKEN: token,
      OPERATOR_TELEGRAM_CHAT_ID: "-999",
    }),
  ).toThrow("OPERATOR_TELEGRAM_BOT_TOKEN");
});
it("exposes only scoped aggregates and fixed failure categories; evaluates backlog and ambiguous failures", async () => {
  const tenantId = new mongoose.Types.ObjectId(),
    other = new mongoose.Types.ObjectId();
  await NotificationJob.create([
    { tenantId, kind: "test", key: "p" },
    ...Array.from({ length: 3 }, (_, i) => ({
      tenantId: other,
      kind: "test",
      key: String(i),
      status: "failed",
      errorCode: "UNKNOWN_OUTCOME",
    })),
    {
      tenantId: other,
      kind: "test",
      key: "private",
      status: "failed",
      errorCode: "secret student token",
    },
  ]);
  const scoped = await queueSnapshot(tenantId);
  expect(scoped.counts.pending).toBe(1);
  expect(scoped.counts.failed).toBe(0);
  const global = await platformNotificationSnapshot();
  expect(global.queue.unknownOutcome).toBe(3);
  expect(global.queue.failuresByCategory.other).toBe(1);
  expect(
    evaluateAlerts(global, { ...config, MONITOR_BACKLOG_THRESHOLD: 1 }),
  ).toEqual(
    expect.arrayContaining(["SCHEDULER_STALE", "UNKNOWN_OUTCOMES", "BACKLOG"]),
  );
  expect(JSON.stringify(global)).not.toMatch(
    /secret student token|tenantId|reportText|chatId/,
  );
});
it("tracks background work after acknowledgement, blocks new work on shutdown and drains safely", async () => {
  const lifecycle = new BackgroundLifecycle(),
    gate = deferred();
  expect(
    lifecycle.start(async (signal) => {
      await gate.promise;
      expect(signal.aborted).toBe(true);
    }),
  ).toBe(true);
  expect(lifecycle.activeCount).toBe(1);
  lifecycle.stop();
  expect(lifecycle.start(async () => {})).toBe(false);
  let drained = false;
  const drain = lifecycle.drain().then(() => {
    drained = true;
  });
  await Promise.resolve();
  expect(drained).toBe(false);
  gate.resolve();
  await drain;
  expect(lifecycle.activeCount).toBe(0);
});
it("stops before delivery on a temporary database error renewing ownership", async () => {
  const gate = deferred(),
    a = tasks();
  a.saas.mockReturnValue(gate.promise);
  const run = runNotificationAutomation(config, a);
  await vi.waitFor(() => expect(a.saas).toHaveBeenCalledOnce());
  vi.spyOn(NotificationSchedulerLease, "updateOne").mockRejectedValueOnce(
    new Error("private database URI"),
  );
  gate.resolve();
  expect(await run).toBe(false);
  expect(a.process).not.toHaveBeenCalled();
  expect((await NotificationProcessorState.findById("automation"))?.stage).toBe(
    "failed",
  );
  expect(JSON.stringify(a.log.mock.calls)).not.toContain(
    "private database URI",
  );
});
