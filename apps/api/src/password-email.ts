import type { Config } from "./config.js";

export interface PasswordEmail {
  sendReset(message: { to: string; resetUrl: string }): Promise<void>;
}

/** Adapter for an operator-approved HTTPS email gateway. No provider is selected
 * or contacted by default. A 2xx means gateway acceptance, never inbox delivery. */
export function configuredPasswordEmail(config: Config): PasswordEmail | undefined {
  if (!config.PASSWORD_RECOVERY_ENABLED || !config.PASSWORD_EMAIL_DELIVERY_VERIFIED ||
      !config.PASSWORD_EMAIL_ENDPOINT || !config.PASSWORD_EMAIL_API_KEY || !config.PASSWORD_EMAIL_FROM)
    return undefined;
  return {
    async sendReset({ to, resetUrl }) {
      const response = await fetch(config.PASSWORD_EMAIL_ENDPOINT!, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.PASSWORD_EMAIL_API_KEY}` },
        body: JSON.stringify({
          from: config.PASSWORD_EMAIL_FROM, to,
          subject: "SoftLans Edu — parolni tiklash",
          text: `Parolni tiklash uchun havolani oching: ${resetUrl}\nHavola 15 daqiqa amal qiladi va bir marta ishlatiladi. So‘rovni siz yubormagan bo‘lsangiz, uni e’tiborsiz qoldiring.`,
        }),
      });
      await response.body?.cancel();
      if (!response.ok) throw new Error("Password email gateway rejected delivery");
    },
  };
}

export function resetUrl(origin: string, token: string): string {
  const url = new URL("/reset-password", origin);
  // Fragments never reach HTTP access logs or Referer headers. The UI immediately removes it.
  url.hash = new URLSearchParams({ token }).toString();
  return url.href;
}
