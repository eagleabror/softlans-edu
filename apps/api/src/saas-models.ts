import mongoose, { Schema } from "mongoose";

const integer = { type: Number, min: 0, validate: Number.isSafeInteger };
const limit = { ...integer, default: null, validate: (v: unknown) => v == null || Number.isSafeInteger(v) };
const planSchema = new Schema({
  name: { type: String, required: true, maxlength: 100 },
  code: { type: String, required: true, match: /^[a-z0-9_-]+$/, maxlength: 40 },
  monthlyPriceUZS: { ...integer, required: true },
  studentLimit: limit, groupLimit: limit,
  features: { type: [String], default: [] },
  isActive: { type: Boolean, required: true, default: true },
}, { timestamps: true, strict: "throw" });
planSchema.index({ code: 1 }, { unique: true });
export const Plan = mongoose.model("SaasPlan", planSchema);

const subscriptionSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  planId: { type: Schema.Types.ObjectId, required: true },
  planName: { type: String, required: true }, planCode: { type: String, required: true },
  status: { type: String, required: true, enum: ["trialing", "active", "past_due", "expired", "suspended", "cancelled"] },
  periodStart: { type: Date, required: true }, periodEnd: { type: Date, required: true },
  trialStart: { type: Date, default: null }, trialEnd: { type: Date, default: null },
  agreedPriceUZS: { ...integer, required: true },
  studentLimit: limit, groupLimit: limit,
  features: { type: [String], default: [] },
  pendingPlanId: { type: Schema.Types.ObjectId, default: null },
}, { timestamps: true, strict: "throw" });
subscriptionSchema.index({ tenantId: 1 }, { unique: true });
subscriptionSchema.index({ status: 1, periodEnd: 1 });
export const Subscription = mongoose.model("SaasSubscription", subscriptionSchema);

const requestSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  planId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  planName: { type: String, required: true, immutable: true },
  planCode: { type: String, required: true, immutable: true },
  amountUZS: { ...integer, required: true, immutable: true },
  monthlyPriceUZS: { ...integer, required: true, immutable: true },
  studentLimit: { ...limit, immutable: true }, groupLimit: { ...limit, immutable: true },
  features: { type: [String], default: undefined, immutable: true },
  billingPeriod: { type: Number, required: true, min: 1, max: 12, validate: Number.isInteger, immutable: true },
  status: { type: String, required: true, enum: ["pending", "approved", "rejected"], default: "pending" },
  submittedBy: { type: Schema.Types.ObjectId, required: true, immutable: true },
  submittedAt: { type: Date, required: true, default: Date.now, immutable: true },
  paidAt: { type: Date, required: true, immutable: true },
  paymentMethod: { type: String, required: true, maxlength: 100, immutable: true },
  transactionNote: { type: String, required: true, maxlength: 500, immutable: true },
  reviewedBy: { type: Schema.Types.ObjectId, default: null },
  reviewedAt: { type: Date, default: null }, reviewNote: { type: String, default: "", maxlength: 500 },
  idempotencyKey: { type: String, required: true, immutable: true, maxlength: 80 },
}, { timestamps: true, strict: "throw" });
requestSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true });
requestSchema.index({ tenantId: 1, submittedAt: -1, _id: -1 });
requestSchema.index({ status: 1, submittedAt: -1, _id: -1 });
export const PaymentRequest = mongoose.model("SaasPaymentRequest", requestSchema);

const auditSchema = new Schema({
  actorId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  tenantId: { type: Schema.Types.ObjectId, default: null, immutable: true },
  action: { type: String, required: true, immutable: true },
  targetId: { type: Schema.Types.ObjectId, default: null, immutable: true },
  reason: { type: String, required: true, maxlength: 500, immutable: true },
  before: { type: Schema.Types.Mixed, default: null, immutable: true },
  after: { type: Schema.Types.Mixed, default: null, immutable: true },
  commandKey: { type: String, immutable: true },
  commandPayload: { type: String, immutable: true },
  createdAt: { type: Date, required: true, default: Date.now, immutable: true },
}, { strict: "throw", versionKey: false });
auditSchema.index({ tenantId: 1, createdAt: -1, _id: -1 });
auditSchema.index({ tenantId: 1, commandKey: 1 }, { unique: true, partialFilterExpression: { commandKey: { $type: "string" } } });
auditSchema.pre("save", function () { if (!this.isNew) throw new Error("SaaS audit is append-only"); });
auditSchema.pre(["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "findOneAndReplace", "deleteOne", "deleteMany", "findOneAndDelete"], function () { throw new Error("SaaS audit is append-only"); });
export const SaasAudit = mongoose.model("SaasAudit", auditSchema);

const trialSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  grantedAt: { type: Date, required: true, default: Date.now, immutable: true },
}, { strict: "throw" });
trialSchema.index({ tenantId: 1 }, { unique: true });
export const TrialGrant = mongoose.model("SaasTrialGrant", trialSchema);

const settingsSchema = new Schema({
  _id: { type: String, default: "platform" },
  instructions: { type: String, default: "", maxlength: 4000 },
  approved: { type: Boolean, default: false },
  approvedBy: { type: Schema.Types.ObjectId, default: null },
  approvedAt: { type: Date, default: null },
}, { timestamps: true, strict: "throw" });
export const SaasSettings = mongoose.model("SaasSettings", settingsSchema);
export const saasModels = [Plan, Subscription, PaymentRequest, SaasAudit, TrialGrant, SaasSettings];
