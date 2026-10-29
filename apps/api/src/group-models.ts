import mongoose, { Schema, type InferSchemaType } from "mongoose";
const ref = (name: string) => ({
  type: Schema.Types.ObjectId,
  ref: name,
  required: true,
  immutable: true,
});
const integer = {
  validator: Number.isSafeInteger,
  message: "Butun son kiriting.",
};
const groupSchema = new Schema(
  {
    tenantId: ref("Tenant"),
    name: { type: String, required: true, trim: true, maxlength: 120 },
    courseName: { type: String, required: true, trim: true, maxlength: 120 },
    teacherId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    capacity: {
      type: Number,
      required: true,
      min: 1,
      max: 10000,
      validate: integer,
    },
    monthlyFee: {
      type: Number,
      required: true,
      min: 0,
      max: Number.MAX_SAFE_INTEGER,
      validate: integer,
    },
    status: {
      type: String,
      enum: ["active", "paused", "archived"],
      required: true,
      default: "active",
    },
    startDate: { type: Date, required: true },
    description: { type: String, trim: true, maxlength: 2000 },
    activeMemberCount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: integer,
    },
  },
  { timestamps: true, strict: "throw" },
);
groupSchema.index({ tenantId: 1, status: 1, createdAt: -1, _id: -1 });
groupSchema.index({ tenantId: 1, teacherId: 1, createdAt: -1, _id: -1 });
const membershipSchema = new Schema(
  {
    tenantId: ref("Tenant"),
    groupId: ref("Group"),
    studentId: ref("Student"),
    enrolledAt: {
      type: Date,
      required: true,
      default: Date.now,
      immutable: true,
    },
    status: {
      type: String,
      enum: ["active", "removed"],
      required: true,
      default: "active",
    },
  },
  { timestamps: true, strict: "throw" },
);
membershipSchema.index(
  { tenantId: 1, groupId: 1, studentId: 1 },
  { unique: true, partialFilterExpression: { status: "active" } },
);
membershipSchema.index({
  tenantId: 1,
  groupId: 1,
  status: 1,
  enrolledAt: -1,
  _id: -1,
});
membershipSchema.index({ tenantId: 1, studentId: 1, status: 1 });
export const Group = mongoose.model("Group", groupSchema);
export const Membership = mongoose.model("Membership", membershipSchema);
export type GroupRecord = InferSchemaType<typeof groupSchema> & {
  _id: mongoose.Types.ObjectId;
};
