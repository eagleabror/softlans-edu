import { PayrollRun, PayrollRunItem } from "./payroll-automation-models.js";
import { cashModels } from "./cash-models.js";
import { securityModels } from "./security-models.js";
import { onboardingSchema } from "./onboarding-model.js";
import { leadModels } from "./lead-models.js";
import { PlatformAudit } from "./super-admin-models.js";
import { StudentImportLog, StudentImportSession } from "./import-models.js";
import { DailyReportSettings } from "./daily-report-models.js";
import { notificationModels } from "./notification-models.js";
import { telegramModels } from "./telegram-models.js";
import {
  SalaryRule,
  Payroll,
  SalaryPayout,
  SalaryPayoutReversal,
  PayrollAudit,
} from "./payroll-models.js";
import { LessonSession, AttendanceRecord } from "./attendance-models.js";
import {
  Charge,
  Payment,
  PaymentReversal,
  ChargeAdjustment,
} from "./billing-models.js";
import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { saasModels } from "./saas-models.js";
import { SaasReminder } from "./saas-reminders-models.js";
import { ensureSaasDefaults } from "./saas-service.js";
import { Classroom, Schedule } from "./schedule-models.js";
import { Group, Membership } from "./group-models.js";
import { normalizeName, normalizePhone } from "./student-validation.js";

const tenantSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    phone: { type: String, trim: true, maxlength: 16, match: /^\+?\d{7,15}$|^$/ },
    address: { type: String, trim: true, maxlength: 300 },
    onboarding: { type: onboardingSchema, default: undefined },
    passwordSecurityRevision: { type: Number, default: 0, select: false },
    billingRevision: { type: Number, default: 0, select: false },
    subscriptionRevision: { type: Number, default: 0, select: false },
    schedulingRevision: { type: Number, default: 0, select: false },
    active: { type: Boolean, default: true, required: true },
    statusRevision: { type: Number, default: 0, min: 0, select: false },
  },
  { timestamps: true, strict: "throw" },
);
tenantSchema.index({ createdAt: -1, _id: -1 });
tenantSchema.index({ active: 1, createdAt: -1, _id: -1 });

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
    // Embedded reset state makes consumption + password/session update a single CAS.
    // No TTL index on User: expiration is checked explicitly and must never delete accounts.
    passwordResetHash: { type: String, select: false },
    passwordResetExpiresAt: { type: Date, select: false },
    passwordResetRequestedAt: { type: Date, select: false },
    mfaEnabled: { type: Boolean, default: false, select: false },
    mfaSecret: { type: String, select: false },
    mfaPendingSecret: { type: String, select: false },
    mfaPendingExpiresAt: { type: Date, select: false },
    mfaLastStep: { type: Number, default: -1, select: false },
    mfaRecoveryHashes: { type: [String], default: [], select: false },
    mfaRevision: { type: Number, default: 0, select: false },
    mfaAttemptCount: { type: Number, default: 0, select: false },
    mfaWindowStart: { type: Date, select: false },
    securityRevision: { type: Number, default: 0, select: false },
    sessionVersion: { type: Number, required: true, default: 0, select: false },
  },
  { timestamps: true, strict: "throw" },
);
userSchema.index({ passwordResetHash: 1 }, { sparse: true });
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

const studentSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      immutable: true,
    },
    firstName: {
      type: String,
      required: true,
      trim: true,
      set: normalizeName,
      match: /^[\p{L}\p{M} ‘ʼ'’`-]+$/u,
      maxlength: 100,
    },
    lastName: {
      type: String,
      required: true,
      trim: true,
      set: normalizeName,
      match: /^[\p{L}\p{M} ‘ʼ'’`-]+$/u,
      maxlength: 100,
    },
    phone: {
      type: String,
      trim: true,
      set: normalizePhone,
      maxlength: 16,
      match: /^\+?\d{7,15}$|^$/,
    },
    parentName: {
      type: String,
      trim: true,
      set: normalizeName,
      maxlength: 100,
    },
    parentPhone: {
      type: String,
      trim: true,
      set: normalizePhone,
      maxlength: 16,
      match: /^\+?\d{7,15}$|^$/,
    },
    birthDate: { type: Date, default: null },
    archivedAt: { type: Date, default: null },
    enrollmentDate: { type: Date, required: true, default: Date.now },
    status: {
      type: String,
      enum: ["active", "paused", "archived"],
      required: true,
      default: "active",
    },
    notes: { type: String, trim: true, maxlength: 2000 },
    importId: { type: Schema.Types.ObjectId, immutable: true },
    membershipRevision: { type: Number, default: 0, select: false },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
    },
  },
  { timestamps: true, strict: "throw" },
);
studentSchema.index({ tenantId: 1, phone: 1 });
studentSchema.index({ tenantId: 1, enrollmentDate: -1, _id: -1 });
studentSchema.index({ tenantId: 1, status: 1, enrollmentDate: -1, _id: -1 });
export const Student = mongoose.model("Student", studentSchema);
export type StudentRecord = InferSchemaType<typeof studentSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const Tenant = mongoose.model("Tenant", tenantSchema);
export const User = mongoose.model("User", userSchema);
export type UserRecord = InferSchemaType<typeof userSchema> & {
  _id: mongoose.Types.ObjectId;
};
export async function ensureIndexes() {
  for (const model of [
    ...securityModels,
    ...cashModels,
    ...saasModels,
    SaasReminder,
    PlatformAudit,
    StudentImportLog,
    StudentImportSession,
    ...leadModels,
    ...telegramModels,
    ...notificationModels,
    DailyReportSettings,
    PayrollRun,
    PayrollRunItem,
    SalaryRule,
    Payroll,
    SalaryPayout,
    SalaryPayoutReversal,
    PayrollAudit,
    LessonSession,
    AttendanceRecord,
  ]) {
    await model.createCollection();
    await model.createIndexes();
  }
  for (const model of [Charge, Payment, PaymentReversal, ChargeAdjustment]) {
    await model.createCollection();
    await model.createIndexes();
  }
  await Classroom.createCollection();
  await Schedule.createCollection();
  await Classroom.createIndexes();
  await Schedule.createIndexes();
  await Group.createCollection();
  await Membership.createCollection();
  await Group.createIndexes();
  await Membership.createIndexes();
  await Student.createCollection();
  await Student.createIndexes();
  await Tenant.createCollection();
  await User.createCollection();
  await Tenant.createIndexes();
  await User.createIndexes();
  await ensureSaasDefaults();
}
