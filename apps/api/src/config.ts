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
    NOTIFICATION_SCHEDULER_SECRET: z
      .string()
      .regex(/^[A-Za-z0-9_+\/=-]{43,128}$/)
      .optional(),
    TELEGRAM_BOT_TOKEN: z.string().optional(),
    TELEGRAM_BOT_USERNAME: z.string().optional(),
    TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
    PASSWORD_RECOVERY_ENABLED: booleanFlag.default(false),
    PASSWORD_EMAIL_DELIVERY_VERIFIED: booleanFlag.default(false),
    PASSWORD_EMAIL_ENDPOINT: z.string().url().refine((v) => {
      const u = new URL(v);
      return u.protocol === "https:" && !u.username && !u.password && !u.search && !u.hash;
    }).optional(),
    PASSWORD_EMAIL_API_KEY: z.string().min(32).regex(/^[^\r\n]+$/).optional(),
    PASSWORD_EMAIL_FROM: z.string().email().optional(),
    JWT_SECRET: z.string().min(48),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    DEMO_MODE: booleanFlag.default(false),
    PUBLIC_REGISTRATION_ENABLED: booleanFlag.optional(),
  })
  .superRefine((value, ctx) => {
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
