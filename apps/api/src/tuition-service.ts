import mongoose, { type ClientSession, type Types } from "mongoose";
import { createHash } from "node:crypto";
import { TuitionRun } from "./tuition-run-model.js";
import { Charge } from "./billing-models.js";
import { Group, Membership } from "./group-models.js";
import { Schedule } from "./schedule-models.js";
import { LessonSession } from "./attendance-models.js";
import { Student, Tenant, User } from "./models.js";
import { calculateTuition } from "./billing-calculation.js";
import { currentBillingMonth, monthBounds } from "./billing-validation.js";
import { localDate } from "./schedule-time.js";
import { lockBilling } from "./billing-lock.js";
import type { BillingCalculation } from "@softlans/contracts";

type GroupDoc = InstanceType<typeof Group>;
type Member = { studentId: Types.ObjectId; enrolledAt: Date };
export function previewKey(c: BillingCalculation) {
  // Enrollment time itself advances between preview/save; reject changes to the
  // actual quote (including crossing a lesson start or the local month boundary).
  const { enrolledAt: _instant, firstEnrolledAt, dueDate, ...quote } = c;
  return createHash("sha256")
    .update(
      JSON.stringify({
        ...quote,
        firstEnrollmentMonth: firstEnrolledAt?.slice(0, 7),
        dueDate: dueDate.slice(0, 10),
      }),
    )
    .digest("hex");
}
export async function tuitionCalculation(
  g: GroupDoc,
  m: Member,
  month: string,
  tx: ClientSession,
  dueDay?: number,
) {
  const tenant = { tenantId: g.tenantId },
    { end } = monthBounds(month);
  const schedules = await Schedule.find({ ...tenant, groupId: g._id }).session(
    tx,
  );
  const sessions = await LessonSession.find({
    ...tenant,
    groupId: g._id,
    lessonDate: { $gte: month + "-01", $lt: localDate(end) },
  }).session(tx);
  const firstMembership = await Membership.findOne({
    ...tenant,
    groupId: g._id,
    studentId: m.studentId,
  })
    .sort({ enrolledAt: 1 })
    .session(tx);
  return calculateTuition({
    month,
    monthlyFee: g.monthlyFee,
    groupStartDate: g.startDate,
    enrolledAt: m.enrolledAt,
    firstEnrolledAt: firstMembership?.enrolledAt ?? m.enrolledAt,
    policy: g.billingPolicy,
    dueDay: dueDay ?? g.billingDueDay,
    schedules: schedules.map((s) => ({ ...s.toObject(), id: s.id as string })),
    sessions: sessions.map((s) => ({
      ...s.toObject(),
      scheduleId: String(s.scheduleId),
    })),
  });
}
// Caller must hold the tenant billing lock in this transaction. No update path:
// existing historical/cancelled/paid charges always win over recalculation.
async function planTuitionCharge(
  g: GroupDoc,
  m: Member,
  month: string,
  actor: Types.ObjectId,
  tx: ClientSession,
  source: "manual" | "enrollment" | "scheduled",
  dueDay?: number,
) {
  const filter = {
    tenantId: g.tenantId,
    studentId: m.studentId,
    groupId: g._id,
    billingMonth: month,
  };
  if (await Charge.exists(filter).session(tx)) return null;
  const { end } = monthBounds(month);
  if (g.status !== "active" || g.startDate >= end || m.enrolledAt >= end)
    return null;
  const student = await Student.findOne({
    tenantId: g.tenantId,
    _id: m.studentId,
    status: "active",
    enrollmentDate: { $lt: end },
  }).session(tx);
  if (!student) return null;
  const calculation = await tuitionCalculation(g, m, month, tx, dueDay);
  return {
    ...filter,
    generatedBy: actor,
    payrollTeacherId: g.teacherId,
    originalAmount: g.monthlyFee,
    prorationAmount: calculation.prorationAmount,
    discountAmount: 0,
    finalAmount: calculation.calculatedAmount,
    paidAmount: 0,
    dueDate: calculation.dueDate,
    calculation,
    generationSource: source,
  };
}
export async function createTuitionCharge(
  g: GroupDoc, m: Member, month: string, actor: Types.ObjectId,
  tx: ClientSession, source: "manual" | "enrollment" | "scheduled", dueDay?: number,
) {
  const charge = await planTuitionCharge(g, m, month, actor, tx, source, dueDay);
  if (!charge) return false;
  await Charge.create([charge], { session: tx });
  return true;
}
export async function generateTuitionMonth(
  tenantId: Types.ObjectId,
  actor: Types.ObjectId,
  month: string,
  source: "manual" | "scheduled",
  dueDay?: number,
  options: { dryRun?: boolean; runId?: Types.ObjectId } = {},
) {
  const { end } = monthBounds(month);
  return mongoose.connection.transaction(
    async (tx) => {
      if (!options.dryRun) await lockBilling(tenantId, tx);
      const members = await Membership.find({
        tenantId,
        status: "active",
        enrolledAt: { $lt: end },
      }).session(tx);
      let created = 0, skipped = 0, amount = 0;
      const planned = new Set<string>();
      for (const member of members) {
        const group = await Group.findOne({
          tenantId,
          _id: member.groupId,
        }).session(tx);
        const key = `${member.studentId}/${member.groupId}`;
        const charge = group && !planned.has(key)
          ? await planTuitionCharge(group, member, month, actor, tx, source, dueDay)
          : null;
        if (charge) {
          planned.add(key);
          if (!options.dryRun) await Charge.create([charge], { session: tx });
          created++;
          amount += charge.finalAmount;
          if (!Number.isSafeInteger(amount)) throw new Error("BILLING_TOTAL_LIMIT");
        } else skipped++;
      }
      if (options.runId && !options.dryRun) {
        // Completion and charges commit together, including driver transaction retries.
        const updated = await TuitionRun.updateOne(
          { _id: options.runId, tenantId, status: "running" },
          { $set: { status: "completed", finishedAt: new Date(), created, skipped, amount } },
          { session: tx },
        );
        if (updated.modifiedCount !== 1) throw new Error("BILLING_AUDIT_REQUIRED");
      }
      return {
        created: options.dryRun ? 0 : created,
        wouldCreate: options.dryRun ? created : 0,
        skipped, amount, month, timezone: "Asia/Tashkent", dryRun: !!options.dryRun,
      };
    },
    { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
  );
}
// A bounded, resumable tenant batch. The caller follows nextCursor; failures can
// be retried from the same cursor because every insert is idempotent.
export async function runTuitionBatch(after?: string, now = new Date(), dryRun = false) {
  const tenants = await Tenant.find({
    active: true,
    ...(after ? { _id: { $gt: after } } : {}),
  })
    .sort({ _id: 1 })
    .limit(11);
  const month = currentBillingMonth(now);
  let created = 0, skipped = 0, wouldCreate = 0;
  for (const tenant of tenants.slice(0, 10)) {
    // Persist start before attempting work. A process crash remains visibly running,
    // never a false success; retry creates a new attempt and deduplicates charges.
    const run = dryRun ? null : await TuitionRun.create({ tenantId: tenant._id, month });
    let errorCode: "BILLING_OWNER_REQUIRED" | "BILLING_RUN_FAILED" = "BILLING_RUN_FAILED";
    try {
      const actor = await User.findOne({
        tenantId: tenant._id, role: "business_owner", active: true,
      }).sort({ _id: 1 });
      if (!actor) {
        errorCode = "BILLING_OWNER_REQUIRED";
        throw new Error(errorCode);
      }
      const result = await generateTuitionMonth(
        tenant._id, actor._id, month, "scheduled", undefined,
        { dryRun, runId: run?._id },
      );
      created += result.created;
      skipped += result.skipped;
      wouldCreate += result.wouldCreate;
    } catch (error) {
      if (run) {
        // The status predicate protects a confirmed commit after an ambiguous response.
        await TuitionRun.updateOne(
          { _id: run._id, tenantId: tenant._id, status: "running" },
          { $set: { status: "failed", finishedAt: new Date(), errorCode } },
        );
      }
      throw error;
    }
  }
  return {
    month, created, skipped, wouldCreate, dryRun,
    nextCursor: tenants.length > 10 ? String(tenants[9]!._id) : null,
  };
}
