import mongoose, { type Types } from "mongoose";
import { z } from "zod";
import type { Config } from "./config.js";
import { Tenant, User } from "./models.js";
import { Payroll, PayrollAudit } from "./payroll-models.js";
import { PayrollRun, PayrollRunItem } from "./payroll-automation-models.js";
import { calculatePayroll } from "./payroll-calculation.js";
import { lockBilling } from "./billing-lock.js";
import {
  billingMonth,
  currentBillingMonth,
  monthBounds,
} from "./billing-validation.js";
import { localDate } from "./schedule-time.js";
import { AppError } from "./errors.js";
import { enqueuePayrollReady } from "./payroll-notifications.js";

export const payrollObjectId = z.string().regex(/^[a-f\d]{24}$/i);
export const payrollCursor = z
  .object({
    tenantId: payrollObjectId,
    afterTeacher: payrollObjectId.optional(),
  })
  .strict();
export function previousPayrollMonth(now: Date) {
  const current = currentBillingMonth(now);
  return currentBillingMonth(new Date(+monthBounds(current).start - 1));
}
export function assertPayrollClosed(month: string, now = new Date()) {
  billingMonth.parse(month);
  if (monthBounds(month).end > now)
    throw new AppError(
      409,
      "PAYROLL_MONTH_OPEN",
      "Maosh oyi hali tugamagan. Yopilgan oyni tanlang.",
    );
}
export function payrollDueAt(
  month: string,
  config: Pick<Config, "PAYROLL_CLOSE_DAY" | "PAYROLL_CLOSE_TIME">,
) {
  const following = localDate(monthBounds(month).end).slice(0, 7);
  return new Date(
    `${following}-${String(config.PAYROLL_CLOSE_DAY).padStart(2, "0")}T${config.PAYROLL_CLOSE_TIME}:00+05:00`,
  );
}
const transactionOptions = {
  readConcern: { level: "snapshot" as const },
  writeConcern: { w: "majority" as const },
};
// Same tenant billing lock as manual drafts, rules, charges, adjustments and payouts.
// The unique payroll key is a second, database-enforced deduplication boundary.
async function generateTeacher(
  tenantId: Types.ObjectId,
  teacherId: Types.ObjectId,
  actorId: Types.ObjectId,
  month: string,
  source: "manual" | "scheduled",
  now: Date,
) {
  return mongoose.connection.transaction(async (tx) => {
    await lockBilling(tenantId, tx);
    if (
      !(await User.exists({
        _id: actorId,
        tenantId,
        role: "business_owner",
        active: true,
      }).session(tx))
    )
      throw new AppError(
        409,
        "PAYROLL_OWNER_REQUIRED",
        "Faol biznes egasi talab qilinadi.",
      );
    const teacher = await User.findOne({
      _id: teacherId,
      tenantId,
      role: "teacher",
      active: true,
    }).session(tx);
    if (!teacher)
      throw new AppError(
        409,
        "INVALID_TEACHER_SETTINGS",
        "O‘qituvchi faol emas yoki roli o‘zgargan.",
      );
    const prior = await Payroll.findOne({
      tenantId,
      teacherId,
      payrollMonth: month,
    }).session(tx);
    let payroll = prior;
    if (!payroll) {
      const basis = await calculatePayroll(
        tenantId,
        String(teacherId),
        month,
        tx,
      );
      const [createdPayroll] = await Payroll.create(
        [
          {
            tenantId,
            teacherId,
            payrollMonth: month,
            calculationBasis: basis,
            grossSalary: basis.grossSalary,
            finalSalary: basis.grossSalary,
            status: "draft",
            calculatedAt: now,
            createdBy: actorId,
            generationSource: source,
          },
        ],
        { session: tx },
      );
      payroll = createdPayroll!;
      await PayrollAudit.create(
        [
          {
            tenantId,
            recordedBy: actorId,
            entityId: payroll!._id,
            action: "draft_created",
            reason:
              source === "scheduled"
                ? "Avtomatik oylik qoralama"
                : "Oylik qoralamalarni qo‘lda yaratish",
            after: { month, grossSalary: basis.grossSalary, source },
          },
        ],
        { session: tx },
      );
    }
    await PayrollRunItem.updateOne(
      { tenantId, month, teacherId },
      {
        $set: {
          teacherName: teacher.name,
          status: "ready",
          payrollId: payroll!._id,
        },
        $unset: { code: 1, message: 1 },
      },
      { upsert: true, session: tx },
    );
    return prior ? ("preserved" as const) : ("created" as const);
  }, transactionOptions);
}
export async function generatePayrollBatch(
  tenantId: Types.ObjectId,
  actorId: Types.ObjectId,
  month: string,
  source: "manual" | "scheduled",
  afterTeacher?: string,
  now = new Date(),
) {
  assertPayrollClosed(month, now);
  const teachers = await User.find({
    tenantId,
    role: "teacher",
    active: true,
    ...(afterTeacher ? { _id: { $gt: afterTeacher } } : {}),
  })
    .sort({ _id: 1 })
    .limit(11);
  let created = 0,
    preserved = 0,
    exceptions = 0;
  for (const teacher of teachers.slice(0, 10)) {
    try {
      const result = await generateTeacher(
        tenantId,
        teacher._id,
        actorId,
        month,
        source,
        now,
      );
      if (result === "created") created++;
      else preserved++;
    } catch (error) {
      // Only expected business exceptions become operator-visible items. DB or
      // process failures reject the request: never claim successful completion.
      if (!(error instanceof AppError) || ![409, 422].includes(error.status))
        throw error;
      await mongoose.connection.transaction(async (tx) => {
        await lockBilling(tenantId, tx);
        // A concurrent retry may have succeeded after this calculation failed.
        if (
          await Payroll.exists({
            tenantId,
            teacherId: teacher._id,
            payrollMonth: month,
          }).session(tx)
        )
          return;
        await PayrollRunItem.updateOne(
          { tenantId, month, teacherId: teacher._id },
          {
            $set: {
              teacherName: teacher.name,
              status: "exception",
              code: error.code,
              message: error.message,
            },
            $unset: { payrollId: 1 },
          },
          { upsert: true, session: tx },
        );
      }, transactionOptions);
      exceptions++;
    }
  }
  const nextTeacher = teachers.length > 10 ? String(teachers[9]!._id) : null;
  const status = await mongoose.connection.transaction(async (tx) => {
    await lockBilling(tenantId, tx);
    const eligible = await User.find({
      tenantId,
      role: "teacher",
      active: true,
    })
      .select("_id")
      .session(tx);
    // Deactivated/changed-role accounts leave eligibility without erasing their
    // operator-visible result history or touching any existing salary statement.
    await PayrollRunItem.updateMany(
      {
        tenantId,
        month,
        status: "exception",
        teacherId: { $nin: eligible.map((t) => t._id) },
      },
      {
        $set: {
          status: "excluded",
          code: "TEACHER_INELIGIBLE",
          message:
            "O‘qituvchi faol emas yoki roli o‘zgargan. Bu hisob-kitobdan chiqarilgan.",
        },
      },
      { session: tx },
    );
    const ready = await PayrollRunItem.find({
      tenantId,
      month,
      status: "ready",
    })
      .select("teacherId")
      .session(tx);
    const remaining = await User.exists({
      tenantId,
      active: true,
      role: "teacher",
      _id: { $nin: ready.map((i) => i.teacherId) },
    }).session(tx);
    const failed = await PayrollRunItem.exists({
      tenantId,
      month,
      status: "exception",
    }).session(tx);
    const state = failed
      ? "exceptions"
      : remaining
        ? "processing"
        : "completed";
    const run = await PayrollRun.findOneAndUpdate(
      { tenantId, month },
      {
        $unset: {
          code: 1,
          message: 1,
          ...(state !== "completed" ? { completedAt: 1 } : {}),
        },
        $set: {
          status: state,
          ...(state === "completed" ? { completedAt: now } : {}),
        },
      },
      { upsert: true, new: true, session: tx },
    );
    if (state === "completed") await enqueuePayrollReady(run!, now, tx);
    return state;
  }, transactionOptions);
  return { month, created, preserved, exceptions, status, nextTeacher };
}
export async function runPayrollScheduler(
  config: Config,
  input: { month?: string; cursor?: z.infer<typeof payrollCursor> },
  now = new Date(),
) {
  const month = input.month ?? previousPayrollMonth(now);
  assertPayrollClosed(month, now);
  if (now < payrollDueAt(month, config))
    return {
      month,
      status: "not_due",
      created: 0,
      preserved: 0,
      exceptions: 0,
      nextCursor: null,
    };
  const tenants = await Tenant.find({
    active: true,
    ...(input.cursor ? { _id: { $gte: input.cursor.tenantId } } : {}),
  })
    .sort({ _id: 1 })
    .limit(2);
  const tenant = tenants[0];
  if (!tenant)
    return {
      month,
      status: "completed",
      created: 0,
      preserved: 0,
      exceptions: 0,
      nextCursor: null,
    };
  if (
    await PayrollRun.exists({
      tenantId: tenant._id,
      month,
      status: "completed",
    })
  )
    return {
      month,
      status: "completed",
      created: 0,
      preserved: 0,
      exceptions: 0,
      nextCursor: tenants[1] ? { tenantId: String(tenants[1]._id) } : null,
    };
  const actor = await User.findOne({
    tenantId: tenant._id,
    active: true,
    role: "business_owner",
  }).sort({ _id: 1 });
  if (!actor) {
    await PayrollRun.updateOne(
      { tenantId: tenant._id, month },
      {
        $set: {
          status: "exceptions",
          code: "PAYROLL_OWNER_REQUIRED",
          message:
            "Faol biznes egasi talab qilinadi. Markaz egasini tekshiring.",
        },
        $unset: { completedAt: 1 },
      },
      { upsert: true },
    );
    return {
      month,
      status: "exceptions",
      code: "PAYROLL_OWNER_REQUIRED",
      created: 0,
      preserved: 0,
      exceptions: 1,
      nextCursor: tenants[1] ? { tenantId: String(tenants[1]._id) } : null,
    };
  }
  const result = await generatePayrollBatch(
    tenant._id,
    actor._id,
    month,
    "scheduled",
    String(tenant._id) === input.cursor?.tenantId
      ? input.cursor.afterTeacher
      : undefined,
    now,
  );
  const nextCursor = result.nextTeacher
    ? { tenantId: String(tenant._id), afterTeacher: result.nextTeacher }
    : tenants[1]
      ? { tenantId: String(tenants[1]._id) }
      : null;
  return { ...result, nextCursor };
}
