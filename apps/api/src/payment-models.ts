import mongoose, { Schema } from "mongoose";

const provider = { type: String, enum: ["payme", "click"], required: true } as const;
const environment = { type: String, enum: ["test", "production"], required: true } as const;
const money = { type: Number, required: true, min: 0, validate: Number.isSafeInteger };
const gatewaySchema = new Schema({
  provider, environment, enabled: { type: Boolean, default: false },
  merchantId: { type: String, required: true }, serviceId: { type: String, default: "" },
  login: { type: String, default: "Paycom" }, secret: { type: String, required: true, select: false },
  revision: { type: Number, default: 1 }, activityRevision: { type: Number, default: 0 },
  merchantSequence: { type: Number, default: 0 },
  used: { type: Boolean, default: false }, lastCallbackAt: { type: Date, default: null },
  lastError: { type: String, default: "" },
}, { timestamps: true, strict: "throw" });
gatewaySchema.index({ provider: 1, environment: 1 }, { unique: true });
export const PaymentProvider = mongoose.model("SaasPaymentProvider", gatewaySchema);

const orderSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  submittedBy: { type: Schema.Types.ObjectId, required: true, immutable: true },
  provider, environment, gatewayId: { type: Schema.Types.ObjectId, required: true },
  idempotencyKey: { type: String, required: true, immutable: true },
  planId: { type: Schema.Types.ObjectId, required: true }, planName: { type: String, required: true }, planCode: { type: String, required: true },
  monthlyPriceUZS: money, amountUZS: money,
  studentLimit: { type: Number, default: null }, groupLimit: { type: Number, default: null },
  features: { type: [String], default: [] }, billingPeriod: { type: Number, required: true, min: 1, max: 12 },
  status: { type: String, enum: ["pending", "paid", "cancelled", "refunded"], default: "pending" },
  expiresAt: { type: Date, required: true }, paidAt: { type: Date, default: null },
  refundedAt: { type: Date, default: null }, refundResolvedAt: { type: Date, default: null },
  refundReference: { type: String, default: "" },
  fulfillmentError: { type: String, default: "" },
  // Immutable evidence for an operator adjustment; never restore an old subscription blindly.
  subscriptionBefore: { type: Schema.Types.Mixed, default: null }, subscriptionAfter: { type: Schema.Types.Mixed, default: null },
}, { timestamps: true, strict: "throw" });
orderSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true });
orderSchema.index({ tenantId: 1, createdAt: -1, _id: -1 });
orderSchema.index({ environment: 1, status: 1, createdAt: -1 });
export const PaymentOrder = mongoose.model("SaasPaymentOrder", orderSchema);
export type Order = InstanceType<typeof PaymentOrder>;

const transactionSchema = new Schema({
  gatewayId: { type: Schema.Types.ObjectId, required: true },
  orderId: { type: Schema.Types.ObjectId, required: true },
  providerId: { type: String, required: true }, providerTime: { type: Number, required: true },
  createTime: { type: Number, required: true }, performTime: { type: Number, default: 0 }, cancelTime: { type: Number, default: 0 },
  state: { type: Number, enum: [1, 2, -1, -2], default: 1 }, reason: { type: Number, default: null },
  amountUZS: money,
  clickPrepareId: { type: Number, default: null },
}, { strict: "throw" });
transactionSchema.index({ gatewayId: 1, providerId: 1 }, { unique: true });
transactionSchema.index({ orderId: 1 }, { unique: true });
transactionSchema.index({ gatewayId: 1, providerTime: 1 });
export const GatewayTransaction = mongoose.model("SaasGatewayTransaction", transactionSchema);
export const paymentModels = [PaymentProvider, PaymentOrder, GatewayTransaction];
