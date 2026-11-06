import mongoose, { type ClientSession, type Types } from "mongoose";
import { createHash } from "node:crypto";
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
export async function createTuitionCharge(
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
  if (await Charge.exists(filter).session(tx)) return false;
  const { end } = monthBounds(month);
  if (g.status !== "active" || g.startDate >= end || m.enrolledAt >= end)
    return false;
  const student = await Student.findOne({
    tenantId: g.tenantId,
    _id: m.studentId,
    status: "active",
    enrollmentDate: { $lt: end },
  }).session(tx);
  if (!student) return false;
  const calculation = await tuitionCalculation(g, m, month, tx, dueDay);
  await Charge.create(
    [
      {
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
      },
    ],
    { session: tx },
  );
  return true;
}
export async function generateTuitionMonth(
  tenantId: Types.ObjectId,
  actor: Types.ObjectId,
  month: string,
  source: "manual" | "scheduled",
  dueDay?: number,
) {
  const { end } = monthBounds(month);
  return mongoose.connection.transaction(
    async (tx) => {
      await lockBilling(tenantId, tx);
      const members = await Membership.find({
        tenantId,
        status: "active",
        enrolledAt: { $lt: end },
      }).session(tx);
      let created = 0,
        skipped = 0;
      for (const member of members) {
        const group = await Group.findOne({
          tenantId,
          _id: member.groupId,
        }).session(tx);
        if (
          group &&
          (await createTuitionCharge(
            group,
            member,
            month,
            actor,
            tx,
            source,
            dueDay,
          ))
        )
          created++;
        else skipped++;
      }
      return { created, skipped, month, timezone: "Asia/Tashkent" };
    },
    { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
  );
}
// A bounded, resumable tenant batch. The caller follows nextCursor; failures can
// be retried from the same cursor because every insert is idempotent.
export async function runTuitionBatch(after?: string, now = new Date()) {
  const tenants = await Tenant.find({
    active: true,
    ...(after ? { _id: { $gt: after } } : {}),
  })
    .sort({ _id: 1 })
    .limit(11);
  const month = currentBillingMonth(now);
  let created = 0,
    skipped = 0;
  for (const tenant of tenants.slice(0, 10)) {
    const actor = await User.findOne({
      tenantId: tenant._id,
      role: "business_owner",
      active: true,
    }).sort({ _id: 1 });
    if (!actor) throw new Error("BILLING_OWNER_REQUIRED");
    const result = await generateTuitionMonth(
      tenant._id,
      actor._id,
      month,
      "scheduled",
    );
    created += result.created;
    skipped += result.skipped;
  }
  return {
    month,
    created,
    skipped,
    nextCursor: tenants.length > 10 ? String(tenants[9]!._id) : null,
  };
}
