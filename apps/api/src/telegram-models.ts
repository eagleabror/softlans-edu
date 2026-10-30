import mongoose, { Schema } from "mongoose";
const oid = { type: Schema.Types.ObjectId, required: true, immutable: true };
const integrationSchema = new Schema(
  {
    tenantId: oid,
    userId: oid,
    // Explicit recipient kind leaves room for separate future student/parent policies.
    recipientKind: { type: String, enum: ["user"], default: "user" },
    telegramUserId: String,
    chatId: String,
    linkedAt: Date,
    status: {
      type: String,
      enum: ["connected", "disconnected"],
      default: "disconnected",
    },
    notificationPreferences: { enabled: { type: Boolean, default: false } },
    tokenHash: { type: String, select: false },
    tokenExpiresAt: Date,
    revision: { type: Number, default: 0 },
  },
  { timestamps: true, strict: "throw" },
);
integrationSchema.index({ tenantId: 1, userId: 1 }, { unique: true });
integrationSchema.index(
  { telegramUserId: 1 },
  { unique: true, partialFilterExpression: { status: "connected" } },
);
integrationSchema.index({ tokenHash: 1 }, { unique: true, sparse: true });
const updateSchema = new Schema(
  {
    updateId: { type: Number, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);
updateSchema.index({ updateId: 1 }, { unique: true });
updateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const deliverySchema = new Schema(
  {
    tenantId: oid,
    userId: oid,
    integrationId: oid,
    integrationRevision: { type: Number, required: true },
    idempotencyKey: { type: String, required: true, maxlength: 160 },
    text: { type: String, required: true, maxlength: 4096, select: false },
    status: {
      type: String,
      enum: ["pending", "sending", "sent", "failed", "cancelled"],
      default: "pending",
    },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now },
    leaseUntil: Date,
    leaseId: String,
    errorCode: String,
    sentAt: Date,
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 86400_000),
    },
  },
  { timestamps: true, strict: "throw" },
);
deliverySchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true });
deliverySchema.index({ status: 1, nextAttemptAt: 1 });
deliverySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const TelegramIntegration = mongoose.model(
  "TelegramIntegration",
  integrationSchema,
);
export const TelegramUpdate = mongoose.model("TelegramUpdate", updateSchema);
export const TelegramDelivery = mongoose.model(
  "TelegramDelivery",
  deliverySchema,
);
// Global bot pacing survives restarts and multiple Render instances.
const dispatchSchema = new Schema({
  _id: String,
  availableAt: { type: Date, required: true },
});
export const TelegramDispatch = mongoose.model(
  "TelegramDispatch",
  dispatchSchema,
);
const webhookRegistrationSchema = new Schema({
  _id: String,
  fingerprint: { type: String, required: true },
});
export const TelegramWebhookRegistration = mongoose.model(
  "TelegramWebhookRegistration",
  webhookRegistrationSchema,
);
export const telegramModels = [
  TelegramIntegration,
  TelegramUpdate,
  TelegramDelivery,
  TelegramDispatch,
  TelegramWebhookRegistration,
];
