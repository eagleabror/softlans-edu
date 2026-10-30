import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Api } from "grammy";
import type { Config } from "../src/config.js";
import { registerTelegramWebhook, telegramWebhookUrl } from "../src/telegram-webhook-registration.js";

const storage = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock("../src/telegram-models.js", async (original) => ({
  ...(await original<typeof import("../src/telegram-models.js")>()),
  TelegramWebhookRegistration: {
    findById: () => ({ lean: storage.read }),
    updateOne: storage.write,
  },
}));
const config = {
  NODE_ENV: "production",
  APP_ORIGIN: "https://softlans-edu-demo.onrender.com",
  TELEGRAM_BOT_TOKEN: "123456:synthetic-test-token",
  TELEGRAM_BOT_USERNAME: "SoftLansTestBot",
  TELEGRAM_WEBHOOK_SECRET: "synthetic_test_secret_".repeat(3),
} as Config;
const correctInfo = {
  url: telegramWebhookUrl,
  has_custom_certificate: false,
  max_connections: 1,
  allowed_updates: ["message"],
  pending_update_count: 0,
};
let saved: { fingerprint: string } | null;
let getInfo: ReturnType<typeof vi.fn>;
let setWebhook: ReturnType<typeof vi.fn>;
let createApi: ReturnType<typeof vi.fn>;
let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.resetAllMocks();
  saved = null;
  storage.read.mockImplementation(async () => saved);
  storage.write.mockImplementation(async (_filter, update) => { saved = update.$set; });
  getInfo = vi.fn().mockResolvedValue(correctInfo);
  setWebhook = vi.fn().mockResolvedValue(true);
  createApi = vi.fn(() => ({ getWebhookInfo: getInfo, setWebhook }) as unknown as Pick<Api, "getWebhookInfo" | "setWebhook">);
  log = vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("startup webhook registration", () => {
  it("applies the secret even when only the public settings already match; persists no credentials", async () => {
    await registerTelegramWebhook(config, createApi);
    expect(createApi).toHaveBeenCalledWith(config.TELEGRAM_BOT_TOKEN);
    expect(setWebhook).toHaveBeenCalledWith(telegramWebhookUrl, {
      secret_token: config.TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: ["message"], max_connections: 1, drop_pending_updates: false,
    });
    expect(saved?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    const output = JSON.stringify([storage.write.mock.calls, log.mock.calls]);
    expect(output).not.toContain(config.TELEGRAM_BOT_TOKEN);
    expect(output).not.toContain(config.TELEGRAM_WEBHOOK_SECRET);
  });
  it("skips setWebhook across startups once confirmed settings match", async () => {
    await registerTelegramWebhook(config, createApi);
    await registerTelegramWebhook(config, createApi);
    expect(getInfo).toHaveBeenCalledTimes(2);
    expect(setWebhook).toHaveBeenCalledOnce();
    expect(log).toHaveBeenLastCalledWith(JSON.stringify({ event: "telegram_webhook_registration", status: "unchanged" }));
  });
  it.each([
    { url: "" }, { url: "https://other.example/webhook" },
    { max_connections: 40 }, { allowed_updates: ["edited_message", "message"] },
    { has_custom_certificate: true }, { allowed_updates: undefined },
  ])("repairs visible drift: %j", async (drift) => {
    await registerTelegramWebhook(config, createApi);
    getInfo.mockResolvedValue({ ...correctInfo, ...drift });
    await registerTelegramWebhook(config, createApi);
    expect(setWebhook).toHaveBeenCalledTimes(2);
  });
  it.each(["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET"] as const)("reapplies rotated %s", async (key) => {
    await registerTelegramWebhook(config, createApi);
    await registerTelegramWebhook({ ...config, [key]: config[key] + "rotated" }, createApi);
    expect(setWebhook).toHaveBeenCalledTimes(2);
  });
  it.each([
    { NODE_ENV: "test" }, { NODE_ENV: "development" },
    { APP_ORIGIN: "https://preview.example.test" },
    { TELEGRAM_BOT_TOKEN: undefined }, { TELEGRAM_BOT_USERNAME: "bad" },
    { TELEGRAM_WEBHOOK_SECRET: "invalid" },
  ])("does not touch Telegram or storage for disabled/non-target instances: %j", async (overrides) => {
    await registerTelegramWebhook({ ...config, ...overrides } as Config, createApi);
    expect(createApi).not.toHaveBeenCalled();
    expect(storage.read).not.toHaveBeenCalled();
    expect(storage.write).not.toHaveBeenCalled();
  });
  it.each(["client", "get", "set", "read", "write", "rejected"])("contains %s failures and logs only safe status", async (step) => {
    const sensitiveError = new Error(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/${config.TELEGRAM_WEBHOOK_SECRET}`);
    if (step === "client") createApi.mockImplementation(() => { throw sensitiveError; });
    if (step === "get") getInfo.mockRejectedValue(sensitiveError);
    if (step === "set") setWebhook.mockRejectedValue(sensitiveError);
    if (step === "read") storage.read.mockRejectedValue(sensitiveError);
    if (step === "write") storage.write.mockRejectedValue(sensitiveError);
    if (step === "rejected") setWebhook.mockResolvedValue(false);
    await expect(registerTelegramWebhook(config, createApi)).resolves.toBeUndefined();
    expect(log.mock.calls).toEqual([[JSON.stringify({ event: "telegram_webhook_registration", status: "failed" })]]);
    expect(saved).toBeNull();
  });
  it("retries on the next startup after a transient API failure", async () => {
    setWebhook.mockRejectedValueOnce(new Error("temporary outage"));
    await registerTelegramWebhook(config, createApi);
    await registerTelegramWebhook(config, createApi);
    expect(saved).not.toBeNull();
    expect(setWebhook).toHaveBeenCalledTimes(2);
  });
});
