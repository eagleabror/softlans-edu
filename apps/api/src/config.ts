import "dotenv/config";
import { z } from "zod";

const booleanFlag = z.enum(["true", "false"]).transform((v) => v === "true");
const schema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    APP_ORIGIN: z
      .string()
      .url()
      .refine((v) => {
        try {
          const url = new URL(v);
          return (
            ["http:", "https:"].includes(url.protocol) &&
            !url.hostname.includes("*") &&
            url.origin === v
          );
        } catch {
          return false;
        }
      }, "Use an exact HTTP(S) origin without a trailing slash"),
    MONGODB_URI: z.string().regex(/^mongodb(?:\+srv)?:\/\//),
    BILLING_SCHEDULER_SECRET: z.string().regex(/^[A-Za-z0-9_+\/=-]{43,128}$/).optional(),
    NOTIFICATION_SCHEDULER_SECRET: z
      .string()
      .regex(/^[A-Za-z0-9_+\/=-]{43,128}$/)
      .optional(),
    TELEGRAM_BOT_TOKEN: z.string().optional(),
    TELEGRAM_BOT_USERNAME: z.string().optional(),
    TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
    MONITOR_SCHEDULER_STALE_SECONDS: z.coerce.number().int()
      .min(120).max(86400).default(180),
    MONITOR_BACKLOG_THRESHOLD: z.coerce.number().int()
      .min(1).max(1000000).default(100),
    OPERATOR_ALERTS_ENABLED: booleanFlag.default(false),
    OPERATOR_ALERTS_SUPPRESSED: booleanFlag.default(false),
    OPERATOR_ALERT_COOLDOWN_MINUTES: z.coerce.number().int()
      .min(5).max(1440).default(30),
    OPERATOR_TELEGRAM_BOT_TOKEN: z.string()
      .regex(/^\d+:[A-Za-z0-9_-]{20,}$/).optional(),
    OPERATOR_TELEGRAM_CHAT_ID: z.string().regex(/^-?\d{1,20}$/).optional(),
    PASSWORD_RECOVERY_ENABLED: booleanFlag.default(false),
    PASSWORD_EMAIL_DELIVERY_VERIFIED: booleanFlag.default(false),
    PASSWORD_EMAIL_ENDPOINT: z.string().url().refine((v) => {
      const u = new URL(v);
      return u.protocol === "https:" && !u.username && !u.password && !u.search && !u.hash;
    }).optional(),
    PASSWORD_EMAIL_API_KEY: z.string().min(32).regex(/^[^\r\n]+$/).optional(),
    PASSWORD_EMAIL_FROM: z.string().email().optional(),
    MFA_ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
    SUPER_ADMIN_MFA_ENFORCED: booleanFlag.default(false),
    SESSION_LEGACY_ISSUED_BEFORE: z.string().datetime().optional(),
    JWT_SECRET: z.string().min(48),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    DEMO_MODE: booleanFlag.default(false),
    PUBLIC_REGISTRATION_ENABLED: booleanFlag.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.OPERATOR_ALERTS_ENABLED &&
      (!value.OPERATOR_TELEGRAM_BOT_TOKEN || !value.OPERATOR_TELEGRAM_CHAT_ID))
      ctx.addIssue({
        code: "custom", path: ["OPERATOR_ALERTS_ENABLED"],
        message: "A separate operator bot and destination are required",
      });
    if (value.OPERATOR_TELEGRAM_BOT_TOKEN && [
      value.TELEGRAM_BOT_TOKEN, value.TELEGRAM_WEBHOOK_SECRET,
      value.JWT_SECRET, value.NOTIFICATION_SCHEDULER_SECRET,
    ].includes(value.OPERATOR_TELEGRAM_BOT_TOKEN))
      ctx.addIssue({
        code: "custom", path: ["OPERATOR_TELEGRAM_BOT_TOKEN"],
        message: "Use a separate operator credential",
      });
    if (value.SUPER_ADMIN_MFA_ENFORCED && !value.MFA_ENCRYPTION_KEY)
      ctx.addIssue({ code: "custom", path: ["MFA_ENCRYPTION_KEY"], message: "MFA key required for enforcement" });
    if (value.MFA_ENCRYPTION_KEY === value.JWT_SECRET)
      ctx.addIssue({ code: "custom", path: ["MFA_ENCRYPTION_KEY"], message: "Use a separate encryption key" });
    if (value.SESSION_LEGACY_ISSUED_BEFORE && Date.parse(value.SESSION_LEGACY_ISSUED_BEFORE) > Date.now())
      ctx.addIssue({ code: "custom", path: ["SESSION_LEGACY_ISSUED_BEFORE"], message: "Migration cutoff must not be in the future" });
    if (value.BILLING_SCHEDULER_SECRET && [value.JWT_SECRET, value.TELEGRAM_WEBHOOK_SECRET,
      value.TELEGRAM_BOT_TOKEN, value.NOTIFICATION_SCHEDULER_SECRET, value.MFA_ENCRYPTION_KEY, value.OPERATOR_TELEGRAM_BOT_TOKEN].includes(value.BILLING_SCHEDULER_SECRET))
      ctx.addIssue({ code: "custom", path: ["BILLING_SCHEDULER_SECRET"], message: "Use a separate billing scheduler secret" });
    if (value.PASSWORD_RECOVERY_ENABLED &&
      (!value.PASSWORD_EMAIL_DELIVERY_VERIFIED || !value.PASSWORD_EMAIL_ENDPOINT ||
       !value.PASSWORD_EMAIL_API_KEY || !value.PASSWORD_EMAIL_FROM)) {
      ctx.addIssue({ code: "custom", path: ["PASSWORD_RECOVERY_ENABLED"],
        message: "A configured and verified email provider is required" });
    }
    if (
      value.NOTIFICATION_SCHEDULER_SECRET &&
      [
        value.JWT_SECRET,
        value.TELEGRAM_WEBHOOK_SECRET,
        value.TELEGRAM_BOT_TOKEN,
      ].includes(value.NOTIFICATION_SCHEDULER_SECRET)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["NOTIFICATION_SCHEDULER_SECRET"],
        message: "Use a separate scheduler secret",
      });
    }
    if (
      value.NODE_ENV === "production" &&
      !value.APP_ORIGIN.startsWith("https://")
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["APP_ORIGIN"],
        message: "HTTPS is required in production",
      });
    }
  });
export const configurationFields = Object.freeze(Object.keys(schema.shape));
export class ConfigurationError extends Error {
  constructor(public readonly fields: string[]) {
    super(`Invalid configuration: ${fields.join(", ")}`);
  }
}
export function parseConfig(env: NodeJS.ProcessEnv) {
  const result = schema.safeParse(env);
  if (!result.success)
    throw new ConfigurationError([
      ...new Set(result.error.issues.map((issue) => String(issue.path[0]))),
    ]);
  return {
    ...result.data,
    PUBLIC_REGISTRATION_ENABLED:
      result.data.PUBLIC_REGISTRATION_ENABLED ?? !result.data.DEMO_MODE,
  };
}
export type Config = ReturnType<typeof parseConfig>;
