import mongoose, { Schema } from "mongoose";

// Separate from student billing and Telegram delivery: this is the durable in-app inbox.
const schema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    subscriptionId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    periodEnd: { type: Date, required: true, immutable: true },
    days: { type: Number, enum: [7, 3, 1], required: true, immutable: true },
    message: { type: String, required: true, maxlength: 500, immutable: true },
  },
  { timestamps: true, strict: "throw" },
);
schema.index({ tenantId: 1, subscriptionId: 1, periodEnd: 1, days: 1 }, { unique: true });
schema.index({ tenantId: 1, createdAt: -1, _id: -1 });
export const SaasReminder = mongoose.model("SaasReminder", schema);
