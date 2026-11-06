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
