import mongoose from "mongoose";
import { parseConfig } from "../config.js";
import { connectDatabase } from "../db.js";
import { User } from "../models.js";
import { unseal } from "../mfa-crypto.js";

// Read-only preflight. Does not activate policy, reset MFA or disclose account identifiers.
try {
  const config = parseConfig(process.env);
  if (!config.MFA_ENCRYPTION_KEY) throw new Error("Missing key");
  await connectDatabase(config.MONGODB_URI);
  const admins = await User.find({ role: "super_admin", active: true }).select("+mfaEnabled +mfaSecret +mfaRecoveryHashes");
  let ready = 0;
  for (const admin of admins) {
    if (admin.mfaEnabled && admin.mfaSecret && admin.mfaRecoveryHashes.length > 0) {
      unseal(admin.mfaSecret, admin._id.toString(), config);
      ready++;
    }
  }
  console.info(JSON.stringify({ event: "mfa_readiness", activeAdmins: admins.length, readyAdmins: ready,
    enrollmentReady: admins.length > 0 && ready === admins.length, recoveryDrillRequired: true }));
  if (!admins.length || ready !== admins.length) process.exitCode = 1;
} catch {
  console.error(JSON.stringify({ event: "mfa_readiness_failed" })); process.exitCode = 1;
} finally { await mongoose.disconnect(); }
