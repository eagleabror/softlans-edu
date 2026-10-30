import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { parseConfig } from "../src/config.js";
import { createApp } from "../src/app.js";
import { connectDatabase } from "../src/db.js";
import { ensureIndexes } from "../src/models.js";
import { NotificationSchedulerLease } from "../src/notification-models.js";
const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("../src/notification-automation.js", () => ({
  runNotificationAutomation: mocks.run,
}));
// Synthetic test-only values; no actual credential or guardian fixture.
const secret = "scheduler-fixture-" + "x".repeat(48);
const env = {
  NODE_ENV: "test",
  APP_ORIGIN: "http://localhost:5173",
  MONGODB_URI: "mongodb://localhost/test",
  JWT_SECRET: "j".repeat(48),
  TELEGRAM_BOT_TOKEN: "123:test",
  TELEGRAM_BOT_USERNAME: "softlans_test_bot",
  TELEGRAM_WEBHOOK_SECRET: "w".repeat(48),
  NOTIFICATION_SCHEDULER_SECRET: secret,
};
const config = parseConfig(env);
const path = "/api/internal/notifications/run";
const post = (app = createApp(config), token = secret) =>
  request(app)
    .post(path)
    .set("Authorization", "Bearer " + token)
    .send({});
let repl: MongoMemoryReplSet;
let log: ReturnType<typeof vi.spyOn>;
beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: "7.0.24" },
  });
  await connectDatabase(repl.getUri("notification-scheduler"));
  await ensureIndexes();
});
afterAll(async () => {
  await mongoose.disconnect();
  await repl?.stop();
});
beforeEach(async () => {
  vi.restoreAllMocks();
  mocks.run.mockReset().mockResolvedValue(true);
  log = vi.spyOn(console, "info").mockImplementation(() => {});
  await NotificationSchedulerLease.deleteMany({});
});
async function released() {
  await vi.waitFor(async () =>
    expect(
      (await NotificationSchedulerLease.findById("http"))?.leaseId,
    ).toBeUndefined(),
  );
}
it("is disabled by default and accepts neither cookies nor webhook secrets", async () => {
  expect(
    (
      await post(
        createApp(
          parseConfig({ ...env, NOTIFICATION_SCHEDULER_SECRET: undefined }),
        ),
      )
    ).status,
  ).toBe(503);
  const app = createApp(config);
  expect(
    (
      await request(app)
        .post(path)
        .set("Cookie", "softlans_session=fake")
        .send({})
    ).status,
  ).toBe(401);
  expect((await post(app, env.TELEGRAM_WEBHOOK_SECRET)).status).toBe(401);
  expect(
    (
      await request(app)
        .post(path)
        .set("X-Telegram-Bot-Api-Secret-Token", secret)
        .send({})
    ).status,
  ).toBe(401);
  expect((await request(app).get(path)).status).toBe(404);
  expect(mocks.run).not.toHaveBeenCalled();
  expect(await NotificationSchedulerLease.countDocuments()).toBe(0);
});
it("rejects credentials in URLs, client recipient overrides and oversized bodies", async () => {
  const app = createApp(config);
  expect(
    (
      await request(app)
        .post(path + "?secret=" + secret)
        .send({})
    ).status,
  ).toBe(401);
  expect(
    (
      await request(app)
        .post(path + "?tenantId=ignored")
        .set("Authorization", "Bearer " + secret)
        .send({})
    ).status,
  ).toBe(400);
  expect(
    (
      await request(app)
        .post(path)
        .set("Authorization", "Bearer " + secret)
        .send({ chatId: "private", text: "custom" })
    ).status,
  ).toBe(400);
  expect(
    (
      await request(app)
        .post(path)
        .set("Authorization", "Bearer " + secret)
        .send({ padding: "x".repeat(2048) })
    ).status,
  ).toBe(413);
  expect(mocks.run).not.toHaveBeenCalled();
});
it("acknowledges before the processor finishes, with no tenant/message/secret response", async () => {
  let finish!: (value: boolean) => void;
  mocks.run.mockReturnValue(
    new Promise<boolean>((resolve) => {
      finish = resolve;
    }),
  );
  const r = await post();
  expect(r.status).toBe(202);
  expect(r.body).toEqual({ status: "accepted" });
  expect(mocks.run).toHaveBeenCalledOnce();
  expect(
    (await NotificationSchedulerLease.findById("http"))?.leaseId,
  ).toBeTruthy();
  expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
  finish(true);
  await released();
});
it("serializes simultaneous HTTP triggers across API instances using MongoDB", async () => {
  let finish!: (value: boolean) => void;
  mocks.run.mockReturnValue(
    new Promise<boolean>((resolve) => {
      finish = resolve;
    }),
  );
  const responses = await Promise.all([
    post(createApp(config)),
    post(createApp(config)),
  ]);
  expect(responses.every((r) => r.status === 202)).toBe(true);
  expect(responses.map((r) => r.body.status).sort()).toEqual([
    "accepted",
    "already_running_or_rate_limited",
  ]);
  expect(mocks.run).toHaveBeenCalledOnce();
  finish(true);
  await released();
});
it("persists admission pacing after completion and recovers a crashed trigger lease", async () => {
  expect((await post()).body.status).toBe("accepted");
  await released();
  expect((await post()).body.status).toBe("already_running_or_rate_limited");
  expect(mocks.run).toHaveBeenCalledOnce();
  await NotificationSchedulerLease.updateOne(
    { _id: "http" },
    {
      $set: {
        leaseId: "old",
        leaseUntil: new Date(0),
        nextAllowedAt: new Date(0),
      },
    },
  );
  expect((await post()).body.status).toBe("accepted");
  await released();
  expect(mocks.run).toHaveBeenCalledTimes(2);
});
it("contains background exceptions and releases the gate without raw error logging", async () => {
  mocks.run.mockRejectedValue(new Error("private-student " + secret));
  expect((await post()).status).toBe(202);
  await released();
  expect(log).toHaveBeenCalledWith(expect.stringContaining("BATCH_FAILED"));
  expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
  expect(JSON.stringify(log.mock.calls)).not.toContain("private-student");
});
it("does not weaken cookie/CSRF protections or webhook authentication", async () => {
  const app = createApp(config);
  expect(
    (
      await request(app)
        .post("/api/auth/logout")
        .set("Authorization", "Bearer " + secret)
        .send({})
    ).status,
  ).toBe(403);
  expect(
    (
      await request(app)
        .patch("/api/notifications/settings")
        .set("Origin", config.APP_ORIGIN)
        .set("Authorization", "Bearer " + secret)
        .send({})
    ).status,
  ).toBe(401);
  expect(
    (
      await request(app)
        .post("/api/integrations/telegram/webhook")
        .set("X-Telegram-Bot-Api-Secret-Token", secret)
        .send({})
    ).status,
  ).toBe(401);
});
it("validates secret length and rejects reuse of existing credentials without exposing values", () => {
  for (const candidate of [
    "short",
    env.JWT_SECRET,
    env.TELEGRAM_WEBHOOK_SECRET,
  ]) {
    expect(() =>
      parseConfig({ ...env, NOTIFICATION_SCHEDULER_SECRET: candidate }),
    ).toThrow("NOTIFICATION_SCHEDULER_SECRET");
    try {
      parseConfig({ ...env, NOTIFICATION_SCHEDULER_SECRET: candidate });
    } catch (e) {
      expect(String(e)).not.toContain(candidate);
    }
  }
});
it("refuses scheduling if Telegram configuration is unavailable", async () => {
  expect(
    (
      await post(
        createApp(parseConfig({ ...env, TELEGRAM_BOT_TOKEN: undefined })),
      )
    ).status,
  ).toBe(503);
  expect(mocks.run).not.toHaveBeenCalled();
});
it("runs the existing durable processor for an actual pending job via the HTTP trigger", async () => {
  const real = await vi.importActual<
    typeof import("../src/notification-automation.js")
  >("../src/notification-automation.js");
  const { Tenant, Student } = await import("../src/models.js");
  const { GuardianLink, NotificationSettings, NotificationJob } =
    await import("../src/notification-models.js");
  const { enqueueNotification, processNotification } =
    await import("../src/notifications.js");
  const tenant = await Tenant.create({ name: "Synthetic center" });
  const student = await Student.create({
    tenantId: tenant._id,
    createdBy: new mongoose.Types.ObjectId(),
    firstName: "Synthetic",
    lastName: "Fixture",
    enrollmentDate: new Date(),
  });
  const guardian = await GuardianLink.create({
    tenantId: tenant._id,
    studentId: student._id,
    authorizedBy: new mongoose.Types.ObjectId(),
    name: "Synthetic guardian",
    expectedTelegramId: "12345",
    chatId: "12345",
    enabled: true,
    verifiedAt: new Date(),
    consentAt: new Date(),
  });
  await NotificationSettings.create({
    tenantId: tenant._id,
    quietStart: "00:00",
    quietEnd: "00:00",
  });
  const job = await enqueueNotification(guardian, {
    kind: "test",
    key: "http-test",
  });
  const send = vi.fn().mockResolvedValue({});
  mocks.run.mockImplementationOnce(() =>
    real.runNotificationAutomation(config, {
      owners: async () => {},
      process: () => processNotification(config, send),
      pause: async () => {},
    }),
  );
  const r = await post();
  expect(r.status).toBe(202);
  await vi.waitFor(async () =>
    expect((await NotificationJob.findById(job!._id))?.status).toBe("sent"),
  );
  await released();
  expect(send).toHaveBeenCalledOnce();
  expect((await NotificationJob.findById(job!._id))?.attempts).toBe(1);
  expect(r.text).not.toContain("12345");
  expect(r.text).not.toContain(secret);
});
