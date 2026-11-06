import { beforeEach, expect, it, vi } from "vitest";
import { databaseReadiness } from "../src/readiness.js";
const mock = vi.hoisted(() => ({
  command: vi.fn(),
  connection: { readyState: 1, db: {} },
}));
vi.mock("mongoose", () => ({ default: { connection: mock.connection } }));
beforeEach(() => {
  vi.restoreAllMocks();
  mock.command.mockReset().mockResolvedValue({ ok: 1 });
  mock.connection.readyState = 1;
  mock.connection.db = { admin: () => ({ command: mock.command }) };
});
it("pings an apparently connected database, coalesces probes and expires cached readiness", async () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(10000),
    ready = databaseReadiness();
  expect(await Promise.all([ready(), ready(), ready()])).toEqual([
    true,
    true,
    true,
  ]);
  expect(mock.command).toHaveBeenCalledOnce();
  expect(mock.command).toHaveBeenCalledWith(
    { ping: 1, maxTimeMS: 1000 },
    { timeoutMS: 1500 },
  );
  clock.mockReturnValue(15001);
  mock.command.mockRejectedValue(new Error("private database URI"));
  expect(await ready()).toBe(false);
  expect(mock.command).toHaveBeenCalledTimes(2);
});
it("fails closed on disconnection even if the last successful ping is cached", async () => {
  const ready = databaseReadiness();
  expect(await ready()).toBe(true);
  mock.connection.readyState = 0;
  expect(await ready()).toBe(false);
});
