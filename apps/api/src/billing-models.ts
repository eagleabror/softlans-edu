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
const chargeSchema = new Schema(
  {
    tenantId: ref("Tenant"),
    generatedBy: ref("User"),
    studentId: ref("Student"),
    groupId: ref("Group"),
    billingMonth: {
      type: String,
      required: true,
      immutable: true,
      match: /^\d{4}-(0[1-9]|1[0-2])$/,
    },
    originalAmount: money,
    discountAmount: { ...money, default: 0 },
    finalAmount: money,
    // Transactionally maintained cache, reconciled from immutable payments/reversals on every write.
    paidAmount: { ...money, default: 0 },
    dueDate: { type: Date, required: true },
    cancelled: { type: Boolean, default: false },
  },
  options,
);
chargeSchema.index(
  { tenantId: 1, studentId: 1, groupId: 1, billingMonth: 1 },
  { unique: true },
);
chargeSchema.index({ tenantId: 1, billingMonth: 1, createdAt: -1 });
chargeSchema.index({ tenantId: 1, cancelled: 1, dueDate: 1, _id: 1 });
chargeSchema.index({ tenantId: 1, cancelled: 1, groupId: 1, billingMonth: 1 });
const paymentSchema = new Schema(
  {
    tenantId: ref("Tenant"),
    studentId: ref("Student"),
    chargeId: ref("Charge"),
    amount: { ...money, min: 1, immutable: true },
    method: {
      type: String,
      enum: ["cash", "bank_transfer", "click_manual"],
      required: true,
      immutable: true,
    },
    paidAt: { type: Date, required: true, immutable: true },
    reference: { type: String, maxlength: 200, immutable: true },
    note: { type: String, maxlength: 1000, immutable: true },
    recordedBy: ref("User"),
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
paymentSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true });
paymentSchema.index({ tenantId: 1, studentId: 1, paidAt: -1, _id: -1 });
paymentSchema.index({ tenantId: 1, chargeId: 1 });
paymentSchema.index({ tenantId: 1, paidAt: -1 });
const reversalSchema = new Schema(
  {
    tenantId: ref("Tenant"),
    paymentId: ref("Payment"),
    reason: { type: String, required: true, maxlength: 1000, immutable: true },
    recordedBy: ref("User"),
  },
  options,
);
reversalSchema.index({ tenantId: 1, paymentId: 1 }, { unique: true });
const adjustmentSchema = new Schema(
  {
    tenantId: ref("Tenant"),
    chargeId: ref("Charge"),
    recordedBy: ref("User"),
    reason: { type: String, required: true, maxlength: 1000, immutable: true },
    before: { type: Schema.Types.Mixed, required: true, immutable: true },
    after: { type: Schema.Types.Mixed, required: true, immutable: true },
  },
  options,
);
adjustmentSchema.index({ tenantId: 1, chargeId: 1, createdAt: 1 });
export const Charge = mongoose.model("Charge", chargeSchema);
export const Payment = mongoose.model("Payment", paymentSchema);
export const PaymentReversal = mongoose.model(
  "PaymentReversal",
  reversalSchema,
);
export const ChargeAdjustment = mongoose.model(
  "ChargeAdjustment",
  adjustmentSchema,
);
