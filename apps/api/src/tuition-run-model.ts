import mongoose, { Schema } from "mongoose";

// One bounded document per tenant attempt; no names, secrets or raw errors.
const count = { type: Number, min: 0, required: true, default: 0, validate: Number.isSafeInteger };
const schema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  month: { type: String, required: true, immutable: true },
  status: { type: String, enum: ["running", "completed", "failed"], default: "running", required: true },
  startedAt: { type: Date, required: true, default: Date.now, immutable: true },
  finishedAt: Date,
  created: count,
  skipped: count,
  amount: count,
  errorCode: { type: String, enum: ["BILLING_OWNER_REQUIRED", "BILLING_RUN_FAILED"] },
}, { strict: "throw" });
schema.index({ tenantId: 1, startedAt: -1, _id: -1 });
export const TuitionRun = mongoose.model("TuitionRun", schema);
