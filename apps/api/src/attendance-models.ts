import mongoose, { Schema } from "mongoose";
const ref = (name: string) => ({
  type: Schema.Types.ObjectId,
  ref: name,
  required: true,
  immutable: true,
});
const sessionSchema = new Schema(
  {
    tenantId: ref("Tenant"),
    groupId: ref("Group"),
    scheduleId: ref("Schedule"),
    teacherId: ref("User"),
    lessonDate: { type: String, required: true, immutable: true },
    startTime: { type: String, required: true, immutable: true },
    endTime: { type: String, required: true, immutable: true },
    groupName: { type: String, required: true, immutable: true },
    roster: { type: [Schema.Types.ObjectId], required: true },
    revision: { type: Number, default: 0, required: true },
    status: {
      type: String,
      enum: ["scheduled", "completed", "cancelled"],
      default: "scheduled",
      required: true,
    },
  },
  { timestamps: true, strict: "throw" },
);
sessionSchema.pre("save", function () {
  if (!this.isNew && this.isModified("roster"))
    throw new Error("Session roster cannot change");
});
sessionSchema.index(
  { tenantId: 1, scheduleId: 1, lessonDate: 1 },
  { unique: true },
);
sessionSchema.index({ tenantId: 1, lessonDate: 1, _id: 1 });
sessionSchema.index({ tenantId: 1, groupId: 1, lessonDate: 1 });
sessionSchema.index({ tenantId: 1, teacherId: 1, lessonDate: 1 });
sessionSchema.index({ tenantId: 1, roster: 1, lessonDate: 1 });
const recordSchema = new Schema(
  {
    tenantId: ref("Tenant"),
    sessionId: ref("LessonSession"),
    studentId: ref("Student"),
    status: {
      type: String,
      enum: ["present", "absent", "late", "excused"],
      required: true,
    },
    note: { type: String, maxlength: 500, default: "" },
    markedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    markedAt: { type: Date, required: true },
  },
  { timestamps: true, strict: "throw" },
);
recordSchema.index(
  { tenantId: 1, sessionId: 1, studentId: 1 },
  { unique: true },
);
recordSchema.index({ tenantId: 1, studentId: 1, sessionId: 1 });
export const LessonSession = mongoose.model("LessonSession", sessionSchema);
export const AttendanceRecord = mongoose.model(
  "AttendanceRecord",
  recordSchema,
);
