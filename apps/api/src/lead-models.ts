import mongoose, { Schema } from "mongoose";
import { statuses, sources, phoneKey } from "./lead-validation.js";
const tenantId = {
  type: Schema.Types.ObjectId,
  required: true,
  immutable: true,
  ref: "Tenant",
};
const ref = (model: string, required = false) => ({
  type: Schema.Types.ObjectId,
  ref: model,
  required,
});
const options = { timestamps: true, strict: "throw" as const };
const leadSchema = new Schema(
  {
    tenantId,
    fullName: { type: String, required: true, maxlength: 200 },
    phone: { type: String, default: "" },
    phoneKey: { type: String, default: "", select: false },
    parentName: String,
    parentPhone: String,
    interestedCourse: { type: String, required: true },
    source: { type: String, enum: sources, required: true },
    status: { type: String, enum: statuses, default: "new", required: true },
    statusChangedAt: { type: Date, default: Date.now },
    assignedTo: ref("User"),
    notes: String,
    nextFollowUpAt: Date,
    convertedStudentId: ref("Student"),
    archivedAt: { type: Date, default: null },
    createdBy: ref("User", true),
  },
  options,
);
leadSchema.pre("validate", function () {
  this.phoneKey = phoneKey(this.phone);
});
leadSchema.index({
  tenantId: 1,
  archivedAt: 1,
  status: 1,
  createdAt: -1,
  _id: -1,
});
leadSchema.index({ tenantId: 1, phoneKey: 1 });
leadSchema.index({ tenantId: 1, assignedTo: 1, createdAt: -1 });
export const Lead = mongoose.model("Lead", leadSchema);
const trialSchema = new Schema(
  {
    tenantId,
    leadId: ref("Lead", true),
    groupId: ref("Group"),
    teacherId: ref("User"),
    trialDate: { type: String, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    result: {
      type: String,
      enum: ["pending", "attended", "absent", "cancelled"],
      default: "pending",
    },
    notes: String,
    createdBy: ref("User", true),
  },
  options,
);
trialSchema.index({ tenantId: 1, trialDate: 1, teacherId: 1 });
export const TrialLesson = mongoose.model("TrialLesson", trialSchema);
const followSchema = new Schema(
  {
    tenantId,
    leadId: ref("Lead", true),
    assignedTo: ref("User", true),
    dueAt: { type: Date, required: true },
    title: { type: String, required: true },
    note: String,
    status: {
      type: String,
      enum: ["pending", "completed", "cancelled"],
      default: "pending",
    },
    createdBy: ref("User", true),
  },
  options,
);
followSchema.index({ tenantId: 1, status: 1, dueAt: 1, assignedTo: 1 });
export const FollowUp = mongoose.model("FollowUp", followSchema);
const historySchema = new Schema(
  {
    tenantId,
    leadId: ref("Lead", true),
    actorId: ref("User", true),
    action: { type: String, required: true },
    fromStatus: String,
    toStatus: String,
    reason: String,
  },
  options,
);
historySchema.index({ tenantId: 1, leadId: 1, createdAt: -1 });
export const LeadHistory = mongoose.model("LeadHistory", historySchema);
export const leadModels = [Lead, TrialLesson, FollowUp, LeadHistory];
