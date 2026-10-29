import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { parseConfig } from "../config.js";
import { connectDatabase } from "../db.js";
import { ensureIndexes, Tenant, User } from "../models.js";
import { passwordSchema } from "../validation.js";

try {
  const config = parseConfig(process.env);
  if (config.NODE_ENV !== "development" || process.env.SEED_DEMO !== "true")
    throw new Error();
  const passwordHash = await bcrypt.hash(
    passwordSchema.parse(process.env.SEED_PASSWORD),
    12,
  );
  await connectDatabase(config.MONGODB_URI);
  await ensureIndexes();
  if (
    await User.exists({
      email: {
        $in: [
          "owner@demo.softlans.test",
          "admin@demo.softlans.test",
          "teacher@demo.softlans.test",
        ],
      },
    })
  )
    throw new Error();
  await mongoose.connection.transaction(async (session) => {
    const [tenant] = await Tenant.create(
      [{ name: "Kelajak o‘quv markazi · Demo" }],
      { session },
    );
    await User.create(
      [
        {
          name: "Aziz Karimov",
          email: "owner@demo.softlans.test",
          role: "business_owner",
          passwordHash,
          tenantId: tenant!._id,
        },
        {
          name: "Madina Aliyeva",
          email: "admin@demo.softlans.test",
          role: "admin",
          passwordHash,
          tenantId: tenant!._id,
        },
        {
          name: "Sardor Usmonov",
          email: "teacher@demo.softlans.test",
          role: "teacher",
          passwordHash,
          tenantId: tenant!._id,
        },
      ],
      { session },
    );
  });
  console.info(
    "Development demo created. Sign in with a demo email and your SEED_PASSWORD.",
  );
} catch {
  console.error(
    "Seed refused or failed. Requires development, SEED_DEMO=true, a valid SEED_PASSWORD and unused demo emails.",
  );
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
