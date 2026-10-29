import mongoose, { Schema, type InferSchemaType } from "mongoose";

const tenantSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    active: { type: Boolean, default: true, required: true },
  },
  { timestamps: true, strict: "throw" },
);

const userSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Tenant",
      default: null,
      index: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    // Globally unique email makes login unambiguous without a client tenant identifier.
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    passwordHash: { type: String, required: true, select: false },
    role: {
      type: String,
      enum: ["super_admin", "business_owner", "admin", "teacher"],
      required: true,
    },
    active: { type: Boolean, required: true, default: true },
    sessionVersion: { type: Number, required: true, default: 0, select: false },
  },
  { timestamps: true, strict: "throw" },
);
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ tenantId: 1, role: 1 });
userSchema.pre("validate", function () {
  if ((this.role === "super_admin") !== (this.tenantId == null)) {
    this.invalidate(
      "tenantId",
      "Super admins are platform scoped; other users require a tenant",
    );
  }
});

export const Tenant = mongoose.model("Tenant", tenantSchema);
export const User = mongoose.model("User", userSchema);
export type UserRecord = InferSchemaType<typeof userSchema> & {
  _id: mongoose.Types.ObjectId;
};
export async function ensureIndexes() {
  await Tenant.createCollection();
  await User.createCollection();
  await Tenant.createIndexes();
  await User.createIndexes();
}
