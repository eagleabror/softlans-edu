import { beforeAll, afterAll, beforeEach, it, expect, vi } from "vitest";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { GrammyError } from "grammy";
import { createApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import { connectDatabase } from "../src/db.js";
import { ensureIndexes, Tenant, User } from "../src/models.js";
import { issueToken } from "../src/security.js";
import {
  TelegramIntegration as Integration,
  TelegramUpdate,
  TelegramDelivery as Delivery,
  TelegramDispatch,
} from "../src/telegram-models.js";
import { hashToken, newLinkToken, validSecret } from "../src/telegram.js";
import {
  dispatchTelegram,
  enqueueTelegram,
  retryDelay,
} from "../src/telegram-delivery.js";
const origin = "http://localhost:5173";
const config = parseConfig({
  NODE_ENV: "test",
  APP_ORIGIN: origin,
  JWT_SECRET: "x".repeat(48),
  MONGODB_URI: "mongodb://localhost/test",
  TELEGRAM_BOT_TOKEN: "123:test",
  TELEGRAM_BOT_USERNAME: "softlans_test_bot",
  TELEGRAM_WEBHOOK_SECRET: "s".repeat(32),
});
const app = createApp(config);
let repl: MongoMemoryReplSet;
let cookie: string,
  other: string,
  tenantId: mongoose.Types.ObjectId,
  userId: mongoose.Types.ObjectId;
let seq = 0;
const base = "/api/integrations/telegram";
const post = (path: string, body = {}, auth = cookie) =>
  request(app)
    .post(base + path)
    .set("Cookie", auth)
    .set("Origin", origin)
    .send(body);
const get = (auth = cookie) => request(app).get(base).set("Cookie", auth);
const webhook = (
  text: string,
  tg = 12345,
  updateId = ++seq,
  secret = config.TELEGRAM_WEBHOOK_SECRET!,
) =>
  request(app)
    .post(base + "/webhook")
    .set("X-Telegram-Bot-Api-Secret-Token", secret)
    .send({
      update_id: updateId,
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        text,
        from: { id: tg, is_bot: false },
        chat: { id: tg, type: "private" },
      },
    });
const link = async (auth = cookie) => {
  const r = await post("/link", {}, auth);
  expect(r.status).toBe(201);
  return new URL(r.body.link).searchParams.get("start")!;
};
async function connected() {
  await webhook("/start " + (await link()));
}
beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: "7.0.24" },
  });
  await connectDatabase(repl.getUri("telegram"));
  await ensureIndexes();
});
afterAll(async () => {
  await mongoose.disconnect();
  await repl?.stop();
});
beforeEach(async () => {
  for (const model of [
    Integration,
    TelegramUpdate,
    Delivery,
    TelegramDispatch,
    User,
    Tenant,
  ])
    await model.deleteMany({});
  tenantId = (await Tenant.create({ name: "Test" }))._id;
  const u = await User.create({
    tenantId,
    role: "teacher",
    name: "Test",
    email: "test@example.test",
    passwordHash: "unused",
  });
  userId = u._id;
  cookie = `softlans_session=${issueToken(u, config)}`;
  const tenant = await Tenant.create({ name: "Other" });
  const v = await User.create({
    tenantId: tenant._id,
    role: "business_owner",
    name: "Other",
    email: "other@example.test",
    passwordHash: "unused",
  });
  other = `softlans_session=${issueToken(v, config)}`;
});
it("generates random URL-safe tokens and compares secrets safely", () => {
  const tokens = new Set(Array.from({ length: 100 }, newLinkToken));
  expect(tokens.size).toBe(100);
  for (const token of tokens) expect(token).toMatch(/^[\w-]{43}$/);
  expect(hashToken("x")).toHaveLength(64);
  expect(validSecret("bad", "secret")).toBe(false);
  expect(validSecret(undefined, "secret")).toBe(false);
  expect(validSecret("secret", "secret")).toBe(true);
});
it("authenticates CRM and preserves CSRF; rejects frontend identities", async () => {
  expect((await request(app).get(base)).status).toBe(401);
  expect(
    (
      await request(app)
        .post(base + "/link")
        .set("Cookie", cookie)
        .send({})
    ).status,
  ).toBe(403);
  expect((await post("/link", { telegramUserId: "12345" })).status).toBe(400);
});
it("links once, stores only hash, and isolates tenants", async () => {
  const token = await link();
  const row = await Integration.findOne().select("+tokenHash");
  expect(row?.tokenHash).toBe(hashToken(token));
  expect(row?.tokenExpiresAt!.getTime()! - Date.now()).toBeLessThanOrEqual(
    600000,
  );
  expect((await webhook("/start " + token)).body.text).toContain(
    "muvaffaqiyatli",
  );
  expect((await get()).body.connected).toBe(true);
  expect((await get(other)).body.connected).toBe(false);
  expect((await webhook("/start " + token, 67890)).body.text).toContain(
    "yaroqsiz",
  );
  expect((await post("/link")).status).toBe(409);
});
it("rejects expired, invalid, rotated and inactive-tenant links", async () => {
  const old = await link();
  const token = await link();
  expect((await webhook("/start " + old)).body.text).toContain("yaroqsiz");
  await Integration.updateOne({}, { $set: { tokenExpiresAt: new Date(0) } });
  expect((await webhook("/start " + token)).body.text).toContain("yaroqsiz");
  const fresh = await link();
  await Tenant.updateOne({ _id: tenantId }, { active: false });
  expect((await webhook("/start " + fresh)).body.text).toContain("yaroqsiz");
  expect((await webhook("/start bad")).body.text).toContain("yaroqsiz");
});
it("rejects bad secrets and malformed payloads independently of browser origin", async () => {
  expect((await webhook("/help", 12345, ++seq, "bad")).status).toBe(401);
  expect(await TelegramUpdate.countDocuments()).toBe(0);
  expect(
    (
      await request(app)
        .post(base + "/webhook")
        .set("X-Telegram-Bot-Api-Secret-Token", config.TELEGRAM_WEBHOOK_SECRET!)
        .send({ update_id: "bad" })
    ).status,
  ).toBe(400);
});
it("deduplicates concurrent webhook updates and prevents Telegram identity sharing", async () => {
  const token = await link();
  const updateId = ++seq;
  const replies = await Promise.all([
    webhook("/start " + token, 12345, updateId),
    webhook("/start " + token, 12345, updateId),
  ]);
  expect(replies.every((r) => r.status === 200)).toBe(true);
  expect(await TelegramUpdate.countDocuments()).toBe(1);
  const otherToken = await link(other);
  expect((await webhook("/start " + otherToken)).body.text).toContain(
    "boshqa hisobga",
  );
  expect((await get(other)).body.connected).toBe(false);
});
it("disconnect revokes pending tokens and identity; requires explicit re-link", async () => {
  const token = await link();
  await post("/disconnect");
  expect((await webhook("/start " + token)).body.text).toContain("yaroqsiz");
  await connected();
  await post("/disconnect", {}, other);
  expect((await get()).body.connected).toBe(true);
  await post("/disconnect");
  expect((await get()).body.connected).toBe(false);
  const row = await Integration.findOne({ userId }).select("+tokenHash");
  expect(row?.telegramUserId).toBeUndefined();
  expect(row?.tokenHash).toBeUndefined();
  await webhook("/start " + (await link(other)));
  expect((await get(other)).body.connected).toBe(true);
});
it("enforces stop and preference changes on queued deliveries", async () => {
  await connected();
  await enqueueTelegram({
    tenantId,
    userId,
    idempotencyKey: "test",
    text: "Synthetic",
  });
  await webhook("/stop");
  expect((await get()).body.notificationPreferences.enabled).toBe(false);
  await expect(
    enqueueTelegram({
      tenantId,
      userId,
      idempotencyKey: "two",
      text: "Synthetic",
    }),
  ).rejects.toThrow();
  const send = vi.fn();
  await dispatchTelegram(config, send);
  expect(send).not.toHaveBeenCalled();
  expect((await Delivery.findOne())?.status).toBe("cancelled");
});
it("tracks success and idempotency without exposing message text", async () => {
  await connected();
  const input = { tenantId, userId, idempotencyKey: "test", text: "Synthetic" };
  await Promise.all([enqueueTelegram(input), enqueueTelegram(input)]);
  expect(await Delivery.countDocuments()).toBe(1);
  const send = vi.fn().mockResolvedValue({});
  await dispatchTelegram(config, send);
  expect(send).toHaveBeenCalledOnce();
  expect((await Delivery.findOne())?.status).toBe("sent");
  expect((await Delivery.findOne().select("+text"))?.text).toBeUndefined();
});
it("persists bounded retries and Telegram rate limits; tracks permanent API errors", async () => {
  await connected();
  await enqueueTelegram({
    tenantId,
    userId,
    idempotencyKey: "test",
    text: "Synthetic",
  });
  const limited = new GrammyError(
    "safe",
    {
      ok: false,
      error_code: 429,
      description: "rate",
      parameters: { retry_after: 90 },
    },
    "sendMessage",
    {},
  );
  await dispatchTelegram(config, vi.fn().mockRejectedValue(limited));
  let job = await Delivery.findOne();
  expect(job?.status).toBe("pending");
  expect(job?.nextAttemptAt.getTime()! - Date.now()).toBeGreaterThan(85000);
  expect(await dispatchTelegram(config, vi.fn())).toBe(false);
  await TelegramDispatch.updateOne({}, { availableAt: new Date(0) });
  await Delivery.updateOne({}, { nextAttemptAt: new Date(0), attempts: 4 });
  await dispatchTelegram(config, vi.fn().mockRejectedValue(limited));
  job = await Delivery.findOne();
  expect(job?.status).toBe("failed");
  expect(job?.attempts).toBe(5);
  expect(retryDelay(100)).toBe(3600000);
});
it("opts out on blocked bot and fails unknown outcomes without unsafe resend", async () => {
  await connected();
  await enqueueTelegram({
    tenantId,
    userId,
    idempotencyKey: "test",
    text: "Synthetic",
  });
  await dispatchTelegram(
    config,
    vi
      .fn()
      .mockRejectedValue(
        new GrammyError(
          "safe",
          { ok: false, error_code: 403, description: "blocked" },
          "sendMessage",
          {},
        ),
      ),
  );
  expect((await get()).body.notificationPreferences.enabled).toBe(false);
  expect((await Delivery.findOne())?.errorCode).toBe("TELEGRAM_403");
});
it("fails safely when Telegram is unconfigured", async () => {
  const disabled = createApp({ ...config, TELEGRAM_BOT_TOKEN: undefined });
  expect((await request(disabled).get("/api/health")).status).toBe(200);
  expect(
    (
      await request(disabled)
        .post(base + "/webhook")
        .send({})
    ).status,
  ).toBe(503);
  expect(
    await dispatchTelegram({ ...config, TELEGRAM_BOT_TOKEN: undefined }),
  ).toBe(false);
});
it("returns Uzbek help/status without private CRM data", async () => {
  expect((await webhook("/help")).body.text).toContain("/stop");
  expect((await webhook("/status")).body.text).toContain("ulanmagan");
  await connected();
  const reply = (await webhook("/status")).body.text;
  expect(reply).toContain("Hisob ulangan");
  expect(reply).not.toContain("example.test");
});
it("does not link group chats, stale messages or forged private identities", async () => {
  const token = await link();
  for (const message of [
    {
      date: 0,
      from: { id: 12345, is_bot: false },
      chat: { id: 12345, type: "private" },
    },
    {
      date: Math.floor(Date.now() / 1000),
      from: { id: 12345, is_bot: false },
      chat: { id: -12345, type: "group" },
    },
    {
      date: Math.floor(Date.now() / 1000),
      from: { id: 12345, is_bot: false },
      chat: { id: 999, type: "private" },
    },
  ]) {
    await request(app)
      .post(base + "/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", config.TELEGRAM_WEBHOOK_SECRET!)
      .send({
        update_id: ++seq,
        message: { message_id: 1, text: "/start " + token, ...message },
      });
  }
  expect((await get()).body.connected).toBe(false);
});
it("retries explicit API server errors but tracks ambiguous network and restart outcomes", async () => {
  await connected();
  await enqueueTelegram({
    tenantId,
    userId,
    idempotencyKey: "test",
    text: "Synthetic",
  });
  await dispatchTelegram(
    config,
    vi
      .fn()
      .mockRejectedValue(
        new GrammyError(
          "safe",
          { ok: false, error_code: 500, description: "server" },
          "sendMessage",
          {},
        ),
      ),
  );
  expect((await Delivery.findOne())?.status).toBe("pending");
  await TelegramDispatch.updateOne({}, { availableAt: new Date(0) });
  await Delivery.updateOne({}, { nextAttemptAt: new Date(0) });
  await dispatchTelegram(
    config,
    vi.fn().mockRejectedValue(new Error("network")),
  );
  expect((await Delivery.findOne())?.errorCode).toBe("UNKNOWN_OUTCOME");
  await Delivery.updateOne({}, { status: "sending", leaseUntil: new Date(0) });
  const send = vi.fn();
  await dispatchTelegram(config, send);
  expect(send).not.toHaveBeenCalled();
  expect((await Delivery.findOne())?.status).toBe("failed");
});
