import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { parseConfig } from "../config.js";
import { connectDatabase } from "../db.js";
import { ensureIndexes, User } from "../models.js";
import { emailSchema, nameSchema, passwordSchema } from "../validation.js";

try {
  const config = parseConfig(process.env);
  const email = emailSchema.parse(process.env.SUPER_ADMIN_EMAIL);
  const name = nameSchema.parse(process.env.SUPER_ADMIN_NAME);
  const password = passwordSchema.parse(process.env.SUPER_ADMIN_PASSWORD);
  await connectDatabase(config.MONGODB_URI);
  await ensureIndexes();
  // Create-only: existing tenant accounts can never be promoted by this script.
  await User.create({
    email,
    name,
    passwordHash: await bcrypt.hash(password, 12),
    role: "super_admin",
    tenantId: null,
  });
  console.info(
    "Super Admin created. Remove provisioning credentials from the environment.",
  );
} catch {
  console.error(
    "Provisioning failed. Check configuration and inputs; the email must be unused.",
  );
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
