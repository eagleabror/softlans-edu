import mongoose, { Schema } from "mongoose";
const log = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true },
    uploadedBy: { type: Schema.Types.ObjectId, required: true },
    filename: { type: String, required: true },
    totalRows: { type: Number, required: true },
    importedRows: { type: Number, default: 0 },
    skippedRows: { type: Number, default: 0 },
    failedRows: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["preview", "running", "completed", "partial", "failed"],
      default: "preview",
    },
    startedAt: Date,
    completedAt: Date,
    deadline: Date,
    idempotencyKey: String,
    decision: String,
    errorSummary: String,
  },
  { timestamps: true, strict: "throw" },
);
log.index({ tenantId: 1, createdAt: -1 });
log.index(
  { tenantId: 1 },
  { unique: true, partialFilterExpression: { status: "running" } },
);
log.index(
  { tenantId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: "string" } },
  },
);
export const StudentImportLog = mongoose.model("StudentImportLog", log);
const session = new Schema<{
  tenantId: mongoose.Types.ObjectId;
  uploadedBy: mongoose.Types.ObjectId;
  headers: string[];
  rows: string[][];
  mapping: Record<string, number>;
  expiresAt: Date;
  revision: number;
}>(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true },
    uploadedBy: { type: Schema.Types.ObjectId, required: true },
    headers: [String],
    rows: { type: [[String]], required: true },
    mapping: { type: Schema.Types.Mixed, required: true },
    expiresAt: { type: Date, required: true },
    revision: { type: Number, default: 0 },
  },
  { strict: "throw" },
);
session.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const StudentImportSession = mongoose.model(
  "StudentImportSession",
  session,
);
