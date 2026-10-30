import mongoose, { Schema } from "mongoose";
const tenantId = {
  type: Schema.Types.ObjectId,
  ref: "Tenant",
  required: true,
  immutable: true,
};
const classroomSchema = new Schema(
  {
    tenantId,
    name: { type: String, required: true, trim: true, maxlength: 120 },
    nameKey: { type: String, required: true, select: false },
    capacity: {
      type: Number,
      min: 1,
      max: 10000,
      validate: Number.isSafeInteger,
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
      required: true,
    },
    description: { type: String, maxlength: 2000 },
  },
  { timestamps: true, strict: "throw" },
);
classroomSchema.index({ tenantId: 1, nameKey: 1 }, { unique: true });
classroomSchema.index({ tenantId: 1, status: 1, name: 1 });
export const Classroom = mongoose.model("Classroom", classroomSchema);
const scheduleSchema = new Schema(
  {
    tenantId,
    groupId: { type: Schema.Types.ObjectId, ref: "Group", required: true },
    teacherId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    classroomId: {
      type: Schema.Types.ObjectId,
      ref: "Classroom",
      required: true,
    },
    dayOfWeek: {
      type: Number,
      min: 1,
      max: 7,
      required: true,
      validate: Number.isSafeInteger,
    },
    startTime: {
      type: String,
      required: true,
      match: /^([01]\d|2[0-3]):[0-5]\d$/,
    },
    endTime: {
      type: String,
      required: true,
      match: /^([01]\d|2[0-3]):[0-5]\d$/,
    },
    effectiveFrom: { type: String, default: null },
    effectiveUntil: { type: String, default: null },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
      required: true,
    },
  },
  { timestamps: true, strict: "throw" },
);
for (const resource of ["groupId", "teacherId", "classroomId"])
  scheduleSchema.index({
    tenantId: 1,
    [resource]: 1,
    status: 1,
    dayOfWeek: 1,
    startTime: 1,
  });
scheduleSchema.pre("validate", function () {
  if (this.startTime >= this.endTime)
    this.invalidate("endTime", "Vaqt oralig‘i noto‘g‘ri.");
});
export const Schedule = mongoose.model("Schedule", scheduleSchema);
