import { Schema } from "mongoose";
export const onboardingSteps = [
  "center",
  "teacher",
  "group",
  "students",
  "telegram",
  "completion",
] as const;
// Disable subdocument __v: transaction rollback must not set a nonexistent version key.
// Concurrency is controlled explicitly by revision on the parent Tenant update.
export const onboardingSchema = new Schema(
  {
    status: {
      type: String,
      enum: ["not_started", "in_progress", "completed", "skipped"],
      default: "not_started",
      required: true,
    },
    completedSteps: { type: [String], enum: onboardingSteps, default: [] },
    currentStep: {
      type: String,
      enum: onboardingSteps,
      default: "center",
      required: true,
    },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    updatedAt: { type: Date, default: Date.now, required: true },
    dismissedAt: { type: Date, default: null },
    schemaVersion: { type: Number, default: 1, required: true },
    revision: { type: Number, default: 0, required: true },
  },
  { _id: false, versionKey: false, strict: "throw" },
);
