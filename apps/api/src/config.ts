import "dotenv/config";
import { z } from "zod";

const schema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    APP_ORIGIN: z
      .string()
      .url()
      .refine(
        (v) => new URL(v).origin === v,
        "Use an origin without a trailing slash",
      ),
    MONGODB_URI: z.string().regex(/^mongodb(?:\+srv)?:\/\//),
    JWT_SECRET: z.string().min(48),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  })
  .superRefine((value, ctx) => {
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
export function parseConfig(env: NodeJS.ProcessEnv) {
  const result = schema.safeParse(env);
  if (!result.success)
    throw new Error(
      `Invalid configuration: ${result.error.issues.map((i) => i.path.join(".")).join(", ")}`,
    );
  return result.data;
}
export type Config = ReturnType<typeof parseConfig>;
