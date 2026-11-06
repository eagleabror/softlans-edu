import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import * as OTPAuth from "otpauth";
import type { Config } from "./config.js";
import { AppError } from "./errors.js";

export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export function encryptionKey(config: Config) {
  if (!config.MFA_ENCRYPTION_KEY)
    throw new AppError(503, "MFA_UNAVAILABLE", "Ikki bosqichli himoya hozircha sozlanmagan. Mas’ulga murojaat qiling.");
  return Buffer.from(config.MFA_ENCRYPTION_KEY, "hex");
}
// AES-GCM is provided by Node/OpenSSL. AAD binds ciphertext to this user and purpose.
export function seal(secret: string, userId: string, config: Config) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(config), iv);
  cipher.setAAD(Buffer.from(`softlans:totp:v1:${userId}`));
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", iv.toString("hex"), cipher.getAuthTag().toString("hex"), ciphertext.toString("hex")].join(":");
}
export function unseal(value: string, userId: string, config: Config) {
  const [version, iv, tag, ciphertext] = value.split(":");
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("Invalid MFA ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(config), Buffer.from(iv, "hex"));
  decipher.setAAD(Buffer.from(`softlans:totp:v1:${userId}`));
  decipher.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "hex")), decipher.final()]).toString("utf8");
}
export function totp(secret: string, label = "SoftLans Edu") {
  return new OTPAuth.TOTP({ issuer: "SoftLans Edu", label, algorithm: "SHA1", digits: 6, period: 30, secret });
}
export const newSecret = () => new OTPAuth.Secret({ size: 20 }).base32;
export function acceptedStep(secret: string, code: string, lastStep: number, now = Date.now()) {
  if (!/^\d{6}$/.test(code)) return null;
  const delta = totp(secret).validate({ token: code, timestamp: now, window: 1 });
  if (delta === null) return null;
  const step = Math.floor(now / 30_000) + delta;
  return step > lastStep ? step : null;
}
export function recoveryCodes() {
  // Each code has 128 random bits. SHA-256 is appropriate for unguessable tokens.
  const codes = Array.from({ length: 10 }, () => randomBytes(16).toString("hex").match(/.{4}/g)!.join("-"));
  return { codes, hashes: codes.map(code => digest(code.replaceAll("-", ""))) };
}
export const recoveryDigest = (code: string) => /^[a-f0-9]{32}$/.test(code.replaceAll("-", "")) ? digest(code.replaceAll("-", "")) : null;
