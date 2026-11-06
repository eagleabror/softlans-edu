import bcrypt from "bcryptjs";
import { z } from "zod";
import { User } from "./models.js";
import { emailSchema, nameSchema, passwordSchema } from "./validation.js";

export function provisioningInput(env: NodeJS.ProcessEnv) {
  const input = z.object({
    MONGODB_URI: z.string().regex(/^mongodb(?:\+srv)?:\/\//),
    SUPER_ADMIN_EMAIL: emailSchema,
    SUPER_ADMIN_NAME: nameSchema,
    SUPER_ADMIN_PASSWORD: passwordSchema,
    PROVISION_FIRST_ADMIN_ONLY: z.enum(["true", "false"]).default("false"),
    PROVISION_WAIT_SECONDS: z.coerce.number().int().min(0).max(900).default(0),
  }).parse(env);
  if (env.GITHUB_ACTIONS === "true") {
    // GitHub never needs the application's JWT secret or Render credentials.
    const uri = new URL(input.MONGODB_URI);
    const expected = env.PROVISION_EXPECTED_DATABASE;
    if (env.GITHUB_REF !== "refs/heads/main" ||
        input.PROVISION_FIRST_ADMIN_ONLY !== "true" ||
        !expected || !/^[a-zA-Z0-9_-]+$/.test(expected) ||
        uri.protocol !== "mongodb+srv:" || !uri.hostname.endsWith(".mongodb.net") ||
        !uri.username || !uri.password || uri.port || uri.hash ||
        decodeURIComponent(uri.pathname) !== `/${expected}`)
      throw new Error("Provisioning target refused");
    // A small allowlist prevents disabling TLS, redirecting auth, or enabling debug options.
    for (const [key, value] of uri.searchParams) {
      if (!((key === "retryWrites" && value === "true") ||
            (key === "w" && value === "majority") ||
            (key === "authSource" && value === "admin") ||
            key === "appName")) throw new Error("Provisioning URI options refused");
    }
  }
  return input;
}

export async function createSuperAdmin(input: ReturnType<typeof provisioningInput>) {
  // Require the already-deployed application's unique email index. No broad
  // collection/index provisioning rights, no update/upsert, no role promotion.
  const indexes = await User.collection.indexes();
  if (!indexes.some((index) => index.unique === true &&
    Object.keys(index.key).length === 1 && index.key.email === 1 &&
    !index.partialFilterExpression && !index.sparse))
    throw new Error("Unique email index required");
  if (input.PROVISION_FIRST_ADMIN_ONLY === "true" &&
      await User.exists({ role: "super_admin" }).maxTimeMS(5_000))
    throw new Error("Platform administrator already exists");
  await User.create({
    email: input.SUPER_ADMIN_EMAIL,
    name: input.SUPER_ADMIN_NAME,
    passwordHash: await bcrypt.hash(input.SUPER_ADMIN_PASSWORD, 12),
    role: "super_admin",
    tenantId: null,
  });
}
