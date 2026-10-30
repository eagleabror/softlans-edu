import mongoose, { Schema } from "mongoose";
const ref = (name: string) => ({
  type: Schema.Types.ObjectId,
  ref: name,
  required: true,
  immutable: true,
});
const money = {
  type: Number,
  required: true,
  min: 0,
  max: Number.MAX_SAFE_INTEGER,
  validate: Number.isSafeInteger,
};
const options = { timestamps: true as const, strict: "throw" as const };
const rule = new Schema(
  {
    tenantId: ref("Tenant"),
    teacherId: ref("User"),
    groupId: {
      type: Schema.Types.ObjectId,
      ref: "Group",
      default: null,
      immutable: true,
    },
    salaryType: {
      type: String,
      enum: ["collected", "billed", "fixed"],
      required: true,
    },
    percentage: { type: Number, min: 0, max: 100, default: null },
    fixedAmount: {
      ...money,
      required: false,
      default: null,
      validate: (v: number | null) => v == null || Number.isSafeInteger(v),
    },
    effectiveFrom: { type: String, required: true },
    effectiveUntil: { type: String, default: null },
    archived: { type: Boolean, default: false },
    createdBy: ref("User"),
  },
  options,
);
rule.index({ tenantId: 1, teacherId: 1, groupId: 1, effectiveFrom: 1 });
const payroll = new Schema(
  {
    tenantId: ref("Tenant"),
    teacherId: ref("User"),
    payrollMonth: { type: String, required: true, immutable: true },
    calculationBasis: { type: Schema.Types.Mixed, required: true },
    grossSalary: money,
    adjustments: { type: [Schema.Types.Mixed], default: [] },
    finalSalary: money,
    paidAmount: { ...money, default: 0 },
    status: {
      type: String,
      enum: ["draft", "approved", "partially_paid", "paid"],
      default: "draft",
      required: true,
    },
    calculatedAt: { type: Date, required: true },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reversedAt: { type: Date, default: null },
    approvedAt: { type: Date, default: null },
    createdBy: ref("User"),
    revision: { type: Number, default: 0 },
  },
  options,
);
payroll.index({ tenantId: 1, teacherId: 1, payrollMonth: 1 }, { unique: true });
payroll.index({ tenantId: 1, payrollMonth: 1, status: 1 });
const payout = new Schema(
  {
    tenantId: ref("Tenant"),
    payrollId: ref("Payroll"),
    recordedBy: ref("User"),
    amount: { ...money, min: 1, immutable: true },
    paidAt: { type: Date, required: true, immutable: true },
    method: {
      type: String,
      enum: ["cash", "bank_transfer"],
      required: true,
      immutable: true,
    },
    reference: { type: String, default: "", maxlength: 200, immutable: true },
    idempotencyKey: { type: String, required: true, immutable: true },
    fingerprint: {
      type: String,
      required: true,
      immutable: true,
      select: false,
    },
  },
  options,
);
payout.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true });
payout.index({ tenantId: 1, payrollId: 1, paidAt: 1 });
const reversal = new Schema(
  {
    tenantId: ref("Tenant"),
    payoutId: ref("SalaryPayout"),
    recordedBy: ref("User"),
    reason: { type: String, required: true, immutable: true, maxlength: 1000 },
  },
  options,
);
reversal.index({ tenantId: 1, payoutId: 1 }, { unique: true });
const audit = new Schema(
  {
    tenantId: ref("Tenant"),
    recordedBy: ref("User"),
    entityId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    action: { type: String, required: true, immutable: true },
    reason: { type: String, required: true, immutable: true },
    before: { type: Schema.Types.Mixed, immutable: true },
    after: { type: Schema.Types.Mixed, immutable: true },
  },
  options,
);
audit.index({ tenantId: 1, entityId: 1, createdAt: 1 });
export const SalaryRule = mongoose.model("SalaryRule", rule);
export const Payroll = mongoose.model("Payroll", payroll);
export const SalaryPayout = mongoose.model("SalaryPayout", payout);
export const SalaryPayoutReversal = mongoose.model(
  "SalaryPayoutReversal",
  reversal,
);
export const PayrollAudit = mongoose.model("PayrollAudit", audit);
