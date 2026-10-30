import { createHmac, createHash } from "node:crypto";
import { Api } from "grammy";
import type { Config } from "./config.js";
import { telegramConfigured } from "./telegram.js";
import { TelegramWebhookRegistration } from "./telegram-models.js";

export const telegramWebhookUrl =
  "https://softlans-edu-demo.onrender.com/api/integrations/telegram/webhook";
const webhookOptions = {
  allowed_updates: ["message"] as ["message"],
  max_connections: 1,
  drop_pending_updates: false,
};

// Called only by the server entrypoint after HTTP is listening. Never log API
// errors: Telegram client errors can contain the token-bearing request URL.
export async function registerTelegramWebhook(
  config: Config,
  createApi: (token: string) => Pick<Api, "getWebhookInfo" | "setWebhook"> =
    (token) => new Api(token, { timeoutSeconds: 10 }),
) {
  const report = (status: string) =>
    console.info(JSON.stringify({ event: "telegram_webhook_registration", status }));
  if (
    config.NODE_ENV !== "production" ||
    config.APP_ORIGIN !== new URL(telegramWebhookUrl).origin ||
    !telegramConfigured(config)
  ) {
    report("skipped");
    return;
  }
  try {
    const token = config.TELEGRAM_BOT_TOKEN!;
    const secret = config.TELEGRAM_WEBHOOK_SECRET!;
    const key = createHash("sha256").update(token).digest("hex");
    // getWebhookInfo omits secret_token. Persist only a keyed fingerprint of
    // successfully applied settings, so first startup and secret rotation reapply it.
    const fingerprint = createHmac("sha256", secret)
      .update(JSON.stringify({ token, url: telegramWebhookUrl, ...webhookOptions }))
      .digest("hex");
    const api = createApi(token);
    const info = await api.getWebhookInfo();
    const previous = await TelegramWebhookRegistration.findById(key).lean();
    if (
      previous?.fingerprint === fingerprint &&
      info.url === telegramWebhookUrl &&
      info.has_custom_certificate === false &&
      info.max_connections === webhookOptions.max_connections &&
      info.allowed_updates?.length === 1 &&
      info.allowed_updates[0] === "message"
    ) {
      report("unchanged");
      return;
    }
    const registered = await api.setWebhook(telegramWebhookUrl, {
      ...webhookOptions,
      secret_token: secret,
    });
    if (!registered) throw new Error("Registration rejected");
    await TelegramWebhookRegistration.updateOne(
      { _id: key },
      { $set: { fingerprint } },
      { upsert: true },
    );
    report("registered");
  } catch {
    // Best effort: the next application startup will check again. No CRM
    // shutdown, secret output, pending-update deletion or background polling.
    report("failed");
  }
}
