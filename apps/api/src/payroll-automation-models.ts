import mongoose, { Schema } from "mongoose";
const options = { timestamps: true as const, strict: "throw" as const };
const run = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    month: { type: String, required: true, immutable: true },
    status: {
      type: String,
      enum: ["processing", "exceptions", "completed"],
      required: true,
    },
    completedAt: Date,
    code: String,
    message: String,
  },
  options,
);
run.index({ tenantId: 1, month: 1 }, { unique: true });
const item = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    month: { type: String, required: true, immutable: true },
    teacherId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    teacherName: { type: String, required: true },
    status: {
      type: String,
      enum: ["ready", "exception", "excluded"],
      required: true,
    },
    payrollId: Schema.Types.ObjectId,
    code: String,
    message: String,
  },
  options,
);
item.index({ tenantId: 1, month: 1, teacherId: 1 }, { unique: true });
export const PayrollRun = mongoose.model("PayrollRun", run);
export const PayrollRunItem = mongoose.model("PayrollRunItem", item);

// Each bounded batch gets its own durable attempt. A running record without a
// finish is intentionally uncertain, never evidence that drafts are ready.
const attempt = new Schema({
  tenantId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  month: { type: String, required: true, immutable: true },
  source: { type: String, enum: ["manual", "scheduled"], required: true, immutable: true },
  afterTeacher: { type: Schema.Types.ObjectId, immutable: true },
  status: { type: String, enum: ["running", "processing", "exceptions", "completed", "failed"], default: "running", required: true },
  startedAt: { type: Date, required: true, default: Date.now, immutable: true },
  finishedAt: Date,
  created: Number,
  preserved: Number,
  exceptions: Number,
  errorCode: { type: String, enum: ["PAYROLL_RUN_FAILED", "PAYROLL_OWNER_REQUIRED"] },
}, { strict: "throw" });
attempt.index({ tenantId: 1, month: 1, startedAt: -1, _id: -1 });
export const PayrollAttempt = mongoose.model("PayrollAttempt", attempt);
