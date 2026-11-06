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
const calculationSchema = new Schema(
  {
    policyVersion: { type: String, required: true },
    policy: {
      type: String,
      enum: ["first_partial_month", "full_month"],
      required: true,
    },
    timezone: { type: String, enum: ["Asia/Tashkent"], required: true },
    month: { type: String, required: true },
    monthlyFee: money,
    totalLessons: money,
    eligibleLessons: money,
    calculatedAmount: money,
    prorationAmount: money,
    approximateLessonPrice: { type: Number, required: true, min: 0 },
    enrolledAt: { type: String, required: true },
    firstEnrolledAt: { type: String, required: true },
    dueDate: { type: String, required: true },
    lessons: {
      type: [new Schema({ key: String, startsAt: String }, { _id: false })],
      required: true,
    },
  },
  { _id: false, strict: "throw" },
);
const chargeSchema = new Schema(
  {
    tenantId: ref("Tenant"),
    generatedBy: ref("User"),
    payrollTeacherId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    studentId: ref("Student"),
    groupId: ref("Group"),
    billingMonth: {
      type: String,
      required: true,
      immutable: true,
      match: /^\d{4}-(0[1-9]|1[0-2])$/,
    },
    calculation: {
      type: calculationSchema,
      immutable: true,
      default: undefined,
    },
    prorationAmount: { ...money, required: false, immutable: true },
    generationSource: {
      type: String,
      enum: ["enrollment", "manual", "scheduled"],
      immutable: true,
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
chargeSchema.pre("save", function () {
  if (
    !this.isNew &&
    (this.isModified("calculation") || this.isModified("prorationAmount"))
  )
    throw new Error("Billing calculation cannot change");
});
// Mongoose's immutable parent option alone does not guard dotted subdocument
// updates. Reject those explicitly, while allowing insert-only initialization.
chargeSchema.pre(["updateOne", "updateMany", "findOneAndUpdate"], function () {
  const update = this.getUpdate();
  if (!update) return;
  const protectedPath = (path: string) =>
    ["calculation", "prorationAmount", "generationSource"].some(
      (root) => path === root || path.startsWith(root + "."),
    );
  if (Array.isArray(update))
    throw new Error("Billing update pipelines are not allowed");
  for (const [operator, values] of Object.entries(update)) {
    if (operator === "$setOnInsert") continue;
    if (
      protectedPath(operator) ||
      (values &&
        typeof values === "object" &&
        Object.entries(values).some(
          ([path, target]) =>
            protectedPath(path) ||
            (operator === "$rename" &&
              typeof target === "string" &&
              protectedPath(target)),
        ))
    )
      throw new Error("Billing calculation cannot change");
  }
});
chargeSchema.pre(["replaceOne", "findOneAndReplace"], function () {
  throw new Error("Charge replacement is not allowed");
});
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
