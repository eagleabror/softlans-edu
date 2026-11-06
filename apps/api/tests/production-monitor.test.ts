import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startProductionMonitor } from "../src/production-monitor.js";
import { BackgroundLifecycle } from "../src/background-lifecycle.js";
import { parseConfig } from "../src/config.js";
const mock = vi.hoisted(() => ({
  ready: vi.fn(),
  snapshot: vi.fn(),
  codes: vi.fn(),
  alert: vi.fn(),
}));
vi.mock("../src/readiness.js", () => ({ databaseReadiness: () => mock.ready }));
vi.mock("../src/notification-monitoring.js", () => ({
  platformNotificationSnapshot: mock.snapshot,
}));
vi.mock("../src/operational-alerts.js", () => ({
  evaluateAlerts: mock.codes,
  sendOperatorAlert: mock.alert,
}));
const config = parseConfig({
  APP_ORIGIN: "http://localhost:5173",
  MONGODB_URI: "mongodb://localhost/synthetic",
  JWT_SECRET: "j".repeat(48),
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  mock.ready.mockResolvedValue(true);
  mock.codes.mockReturnValue(["BACKLOG"]);
  const queue = {
    counts: { pending: 100, sending: 1, failed: 3, cancelled: 2 },
  };
  mock.snapshot.mockResolvedValue({
    processor: { state: "recent", stage: "delivery" },
    queue,
    legacyQueue: queue,
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it("does not send or query the queue when the database is unavailable", async () => {
  const lifecycle = new BackgroundLifecycle();
  mock.ready.mockResolvedValue(false);
  const stop = startProductionMonitor(config, lifecycle);
  await vi.advanceTimersByTimeAsync(60000);
  await lifecycle.drain();
  stop();
  expect(mock.snapshot).not.toHaveBeenCalled();
  expect(mock.alert).not.toHaveBeenCalled();
  expect(console.error).toHaveBeenCalledWith(
    JSON.stringify({
      event: "production_monitor",
      code: "DATABASE_UNAVAILABLE",
    }),
  );
});
it("contains monitor exceptions without secrets and stops sampling at shutdown", async () => {
  const lifecycle = new BackgroundLifecycle();
  mock.snapshot.mockRejectedValue(new Error("private student token URI"));
  const stop = startProductionMonitor(config, lifecycle);
  await vi.advanceTimersByTimeAsync(60000);
  await lifecycle.drain();
  expect(console.error).toHaveBeenCalledWith(
    JSON.stringify({ event: "production_monitor", code: "MONITOR_FAILED" }),
  );
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(
    /private|student|token|URI/,
  );
  lifecycle.stop();
  await vi.advanceTimersByTimeAsync(60000);
  stop();
  expect(mock.snapshot).toHaveBeenCalledOnce();
});
it("never overlaps samples while an independent operator send is pending", async () => {
  const lifecycle = new BackgroundLifecycle();
  let finish!: () => void;
  mock.alert.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const stop = startProductionMonitor(config, lifecycle);
  await vi.advanceTimersByTimeAsync(180000);
  expect(mock.snapshot).toHaveBeenCalledOnce();
  expect(mock.alert).toHaveBeenCalledOnce();
  finish();
  await lifecycle.drain();
  stop();
});
