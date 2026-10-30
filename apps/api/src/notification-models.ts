import mongoose, { Schema } from "mongoose";
const oid = { type: Schema.Types.ObjectId, required: true, immutable: true };
const options = { timestamps: true as const, strict: "throw" as const };
const guardian = new Schema(
  {
    tenantId: oid,
    studentId: oid,
    authorizedBy: oid,
    name: { type: String, required: true, maxlength: 120 },
    expectedTelegramId: { type: String, required: true, select: false },
    chatId: { type: String, select: false },
    tokenHash: { type: String, select: false },
    tokenExpiresAt: Date,
    verifiedAt: Date,
    consentAt: Date,
    withdrawnAt: Date,
    enabled: { type: Boolean, default: false },
    debt: { type: Boolean, default: true },
    attendance: { type: Boolean, default: true },
    lesson: { type: Boolean, default: true },
    revision: { type: Number, default: 0 },
  },
  options,
);
guardian.index({ tokenHash: 1 }, { unique: true, sparse: true });
guardian.index(
  { tenantId: 1, studentId: 1, expectedTelegramId: 1 },
  { unique: true },
);
guardian.index({ expectedTelegramId: 1, verifiedAt: 1 });
const settings = new Schema(
  {
    tenantId: oid,
    debt: { type: Boolean, default: false },
    attendance: { type: Boolean, default: false },
    lesson: { type: Boolean, default: false },
    debtDays: { type: [Number], default: [-3, 0, 3, 7] },
    lessonHours: { type: [Number], default: [24, 1] },
    late: { type: Boolean, default: false },
    excused: { type: Boolean, default: false },
    corrections: { type: Boolean, default: false },
    quietStart: { type: String, default: "21:00" },
    quietEnd: { type: String, default: "08:00" },
    language: { type: String, enum: ["uz", "ru"], default: "uz" },
    debtTemplate: { type: String, maxlength: 500, default: "" },
    attendanceTemplate: { type: String, maxlength: 500, default: "" },
    lessonTemplate: { type: String, maxlength: 500, default: "" },
  },
  options,
);
settings.index({ tenantId: 1 }, { unique: true });
const event = new Schema(
  {
    tenantId: oid,
    studentId: oid,
    sessionId: oid,
    revision: { type: Number, required: true },
    status: { type: String, required: true },
    correction: Boolean,
  },
  options,
);
event.index(
  { tenantId: 1, sessionId: 1, studentId: 1, revision: 1 },
  { unique: true },
);
event.index({ tenantId: 1, studentId: 1, createdAt: 1 });
const job = new Schema(
  {
    tenantId: oid,
    guardianId: { ...oid, required: false },
    studentId: { ...oid, required: false },
    userId: { type: Schema.Types.ObjectId },
    integrationRevision: Number,
    settingsRevision: Number,
    report: Schema.Types.Mixed,
    reportText: { type: String, select: false },
    key: { type: String, required: true },
    kind: {
      type: String,
      enum: [
        "debt",
        "attendance",
        "lesson",
        "test",
        "owner_daily",
        "owner_test",
      ],
      required: true,
    },
    sourceId: Schema.Types.ObjectId,
    eventDate: String,
    timing: Number,
    version: String,
    guardianRevision: { type: Number, required: false },
    status: {
      type: String,
      enum: ["pending", "sending", "sent", "failed", "cancelled"],
      default: "pending",
    },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now },
    leaseId: String,
    leaseUntil: Date,
    errorCode: String,
    sentAt: Date,
    attemptsLog: [{ _id: false, at: Date, code: String }],
  },
  options,
);
job.index({ tenantId: 1, key: 1 }, { unique: true });
job.index({ status: 1, nextAttemptAt: 1 });
job.index({ status: 1, leaseUntil: 1 });
job.index({ tenantId: 1, createdAt: -1, _id: -1 });
const audit = new Schema(
  {
    tenantId: oid,
    actorId: { type: Schema.Types.ObjectId },
    action: String,
    targetId: Schema.Types.ObjectId,
  },
  options,
);
audit.index({ tenantId: 1, createdAt: -1 });
export const GuardianLink = mongoose.model("GuardianLink", guardian);
export const NotificationSettings = mongoose.model(
  "NotificationSettings",
  settings,
);
export const AttendanceEvent = mongoose.model("AttendanceEvent", event);
export const NotificationJob = mongoose.model("NotificationJob", job);
export const NotificationAudit = mongoose.model("NotificationAudit", audit);
// Global liveness metadata only: no tenant/student identifiers, counts, or secrets.
const processorState = new Schema({
  _id: String,
  runId: String,
  lastStartedAt: Date,
  lastHeartbeatAt: Date,
  lastCompletedAt: Date,
  lastFailedAt: Date,
  stage: {
    type: String,
    enum: [
      "planning_guardians",
      "planning_owners",
      "delivery",
      "completed",
      "failed",
    ],
  },
});
export const NotificationProcessorState = mongoose.model(
  "NotificationProcessorState",
  processorState,
);
// HTTP trigger admission gate. Jobs themselves retain the existing send leases.
export const NotificationSchedulerLease = mongoose.model(
  "NotificationSchedulerLease",
  new Schema(
    {
      _id: String,
      leaseId: String,
      leaseUntil: Date,
      nextAllowedAt: Date,
    },
    { strict: "throw" },
  ),
);
export const notificationModels = [
  NotificationSchedulerLease,
  NotificationProcessorState,
  GuardianLink,
  NotificationSettings,
  AttendanceEvent,
  NotificationJob,
  NotificationAudit,
];
