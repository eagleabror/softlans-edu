import mongoose, { Schema } from "mongoose";

// This collection contains operational metadata only, never account snapshots,
// credentials, student/guardian records or financial records.
const schema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    tenantId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    action: { type: String, enum: ["block", "activate"], required: true, immutable: true },
    reason: { type: String, required: true, maxlength: 300, immutable: true },
    previousStatus: { type: String, enum: ["active", "blocked"], required: true, immutable: true },
    newStatus: { type: String, enum: ["active", "blocked"], required: true, immutable: true },
    revision: { type: Number, required: true, min: 1, immutable: true },
    createdAt: { type: Date, default: Date.now, required: true, immutable: true },
  },
  { strict: "throw", versionKey: false },
);
schema.index({ createdAt: -1, _id: -1 });
schema.index({ tenantId: 1, createdAt: -1, _id: -1 });
schema.index({ tenantId: 1, revision: 1 }, { unique: true });
schema.pre("save", function () {
  if (!this.isNew) throw new Error("Platform audit records are append-only");
});
schema.pre(
  ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "findOneAndReplace", "deleteOne", "deleteMany", "findOneAndDelete"],
  function () { throw new Error("Platform audit records are append-only"); },
);
export const PlatformAudit = mongoose.model("PlatformAudit", schema);
