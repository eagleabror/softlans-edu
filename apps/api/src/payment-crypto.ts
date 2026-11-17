import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import type { Config } from "./config.js";
import { AppError } from "./errors.js";

function key(config: Config) {
  if (!config.PAYMENT_CREDENTIALS_ENCRYPTION_KEY) throw new AppError(503, "PAYMENT_KEY_MISSING", "To‘lov kalitlarini shifrlash serverda sozlanmagan.");
  return Buffer.from(config.PAYMENT_CREDENTIALS_ENCRYPTION_KEY, "hex");
}
export function sealPaymentSecret(value: string, binding: string, config: Config) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(config), iv);
  cipher.setAAD(Buffer.from(`softlans:payment:v1:${binding}`));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("hex"), cipher.getAuthTag().toString("hex"), ciphertext.toString("hex")].join(":");
}
export function openPaymentSecret(value: string, binding: string, config: Config) {
  try {
    const [version, iv, tag, ciphertext] = value.split(":");
    if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("Invalid ciphertext");
    const decipher = createDecipheriv("aes-256-gcm", key(config), Buffer.from(iv, "hex"));
    decipher.setAAD(Buffer.from(`softlans:payment:v1:${binding}`));
    decipher.setAuthTag(Buffer.from(tag, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "hex")), decipher.final()]).toString("utf8");
  } catch { throw new AppError(503, "PAYMENT_KEY_UNAVAILABLE", "To‘lov kalitini o‘qib bo‘lmadi. Server sozlamalarini tekshiring."); }
}
export function secretMatches(a: string, b: string) {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
