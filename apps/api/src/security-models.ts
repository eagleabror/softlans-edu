import mongoose, { Schema } from "mongoose";

const sessionSchema = new Schema({
  sid: { type: String, required: true, unique: true },
  userId: { type: Schema.Types.ObjectId, required: true, index: true },
  version: { type: Number, required: true },
  mfa: { type: Boolean, required: true },
  device: { type: String, required: true },
  createdAt: { type: Date, required: true },
  lastActivityAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true, expires: 0 },
  revokedAt: { type: Date },
}, { strict: "throw" });
const challengeSchema = new Schema({
  digest: { type: String, required: true, unique: true },
  userId: { type: Schema.Types.ObjectId, required: true, index: true },
  version: { type: Number, required: true },
  revision: { type: Number, required: true },
  expiresAt: { type: Date, required: true, expires: 0 },
  attempts: { type: Number, required: true, default: 0 },
  consumedAt: { type: Date },
}, { strict: "throw" });
export const DeviceSession = mongoose.model("DeviceSession", sessionSchema);
export const MfaChallenge = mongoose.model("MfaChallenge", challengeSchema);
export const securityModels = [DeviceSession, MfaChallenge];
