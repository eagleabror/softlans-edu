import { Router, type Request } from "express";
import mongoose, { type ClientSession } from "mongoose";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  Charge,
  Payment,
  PaymentReversal,
  ChargeAdjustment,
} from "./billing-models.js";
import { Group, Membership } from "./group-models.js";
import { Student } from "./models.js";
import { principal, requireRoles, tenantScope } from "./security.js";
import { AppError } from "./errors.js";
import { lockBilling } from "./billing-lock.js";
import {
  billingMonth,
  money,
  reason,
  paymentInput,
  listInput,
  monthBounds,
  currentBillingMonth,
} from "./billing-validation.js";
const missing = () => new AppError(404, "NOT_FOUND", "Ma’lumot topilmadi.");
const conflict = (message: string) =>
  new AppError(409, "BILLING_CONFLICT", message);
const scope = (req: Request) => tenantScope(principal(req));
function id(value: unknown) {
  if (!mongoose.isObjectIdOrHexString(value)) throw missing();
  return String(value);
}
export function chargeView(c: InstanceType<typeof Charge>) {
  const remainingAmount = c.cancelled ? 0 : c.finalAmount - c.paidAmount;
  return {
    id: c.id as string,
    studentId: c.studentId.toString(),
    groupId: c.groupId.toString(),
    generatedBy: c.generatedBy.toString(),
    billingMonth: c.billingMonth,
    originalAmount: c.originalAmount,
    discountAmount: c.discountAmount,
    finalAmount: c.finalAmount,
    paidAmount: c.paidAmount,
    remainingAmount,
    status: c.cancelled
      ? "cancelled"
      : remainingAmount === 0
        ? "paid"
        : c.paidAmount
          ? "partial"
          : "unpaid",
    dueDate: c.dueDate.toISOString(),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}
function paymentView(
  p: InstanceType<typeof Payment>,
  r?: InstanceType<typeof PaymentReversal>,
) {
  return {
    id: p.id as string,
    studentId: p.studentId.toString(),
    chargeId: p.chargeId.toString(),
    amount: p.amount,
    method: p.method,
    paidAt: p.paidAt.toISOString(),
    reference: p.reference ?? "",
    note: p.note ?? "",
    recordedBy: p.recordedBy.toString(),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    reversal: r
      ? {
          id: r.id as string,
          reason: r.reason,
          recordedBy: r.recordedBy.toString(),
          createdAt: r.createdAt.toISOString(),
        }
      : null,
  };
}
async function paidFor(
  charge: InstanceType<typeof Charge>,
  session: ClientSession,
) {
  const payments = await Payment.find({
    tenantId: charge.tenantId,
    chargeId: charge._id,
  }).session(session);
  const reversals = await PaymentReversal.find({
    tenantId: charge.tenantId,
    paymentId: { $in: payments.map((p) => p._id) },
  }).session(session);
  return payments
    .filter((p) => !reversals.some((r) => r.paymentId.equals(p._id)))
    .reduce((sum, p) => sum + p.amount, 0);
}
export const billingRouter = Router();
billingRouter.use(requireRoles("business_owner", "admin"));
billingRouter.post("/charges/generate", async (req, res) => {
  const input = z
    .object({
      month: billingMonth,
      dueDay: z.number().int().min(1).max(28).default(10),
      confirmed: z.literal(true),
    })
    .strict()
    .parse(req.body);
  const tenant = scope(req),
    { start, end } = monthBounds(input.month);
  const result = await mongoose.connection.transaction(
    async (session) => {
      await lockBilling(tenant.tenantId, session);
      const members = await Membership.find({
        ...tenant,
        status: "active",
        enrolledAt: { $lt: end },
      }).session(session);
      let created = 0,
        skipped = 0;
      for (const m of members) {
        const g = await Group.findOne({
          ...tenant,
          _id: m.groupId,
          status: "active",
          startDate: { $lt: end },
        }).session(session);
        const s = await Student.findOne({
          ...tenant,
          _id: m.studentId,
          status: "active",
          enrollmentDate: { $lt: end },
        }).session(session);
        if (!g || !s) {
          skipped++;
          continue;
        }
        const filter = {
          ...tenant,
          studentId: m.studentId,
          groupId: m.groupId,
          billingMonth: input.month,
        };
        const effective = Math.max(
          start.getTime(),
          m.enrolledAt.getTime(),
          g.startDate.getTime(),
          s.enrollmentDate.getTime(),
        );
        const dueDate = new Date(
          Math.max(
            new Date(
              `${input.month}-${String(input.dueDay).padStart(2, "0")}T23:59:59.999+05:00`,
            ).getTime(),
            effective,
          ),
        );
        const r = await Charge.updateOne(
          filter,
          {
            $setOnInsert: {
              ...filter,
              generatedBy: principal(req).userId,
              originalAmount: g.monthlyFee,
              discountAmount: 0,
              finalAmount: g.monthlyFee,
              paidAmount: 0,
              dueDate,
            },
          },
          { session, upsert: true, runValidators: true },
        );
        if (r.upsertedCount) created++;
        else skipped++;
      }
      return {
        created,
        skipped,
        month: input.month,
        timezone: "Asia/Tashkent",
      };
    },
    { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
  );
  res.json(result);
});
async function filterFor(req: Request, q: z.infer<typeof listInput>) {
  const tenant = scope(req);
  let studentId: unknown = q.studentId;
  if (q.search) {
    const tokens = q.search
      .split(/\s+/)
      .map((t) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
    const students = await Student.find({
      ...tenant,
      ...(q.studentId ? { _id: q.studentId } : {}),
      $and: tokens.map((re) => ({
        $or: [{ firstName: re }, { lastName: re }],
      })),
    }).select("_id");
    studentId = { $in: students.map((s) => s._id) };
  }
  return {
    ...tenant,
    ...(studentId ? { studentId } : {}),
    ...(q.month ? { billingMonth: q.month } : {}),
    ...(q.groupId ? { groupId: q.groupId } : {}),
    ...(q.status === "cancelled"
      ? { cancelled: true }
      : q.status
        ? {
            cancelled: false,
            ...(q.status === "paid"
              ? { $expr: { $eq: ["$paidAmount", "$finalAmount"] } }
              : q.status === "partial"
                ? {
                    paidAmount: { $gt: 0 },
                    $expr: { $lt: ["$paidAmount", "$finalAmount"] },
                  }
                : { paidAmount: 0, finalAmount: { $gt: 0 } }),
          }
        : {}),
  };
}
async function chargeNames(
  rows: InstanceType<typeof Charge>[],
  tenant: ReturnType<typeof scope>,
) {
  const [students, groups] = await Promise.all([
    Student.find({
      ...tenant,
      _id: { $in: rows.map((c) => c.studentId) },
    }).select("firstName lastName"),
    Group.find({ ...tenant, _id: { $in: rows.map((c) => c.groupId) } }).select(
      "name",
    ),
  ]);
  return rows.map((c) => ({
    ...chargeView(c),
    studentName:
      students
        .filter((s) => s._id.equals(c.studentId))
        .map((s) => `${s.firstName} ${s.lastName}`)[0] ?? "—",
    groupName: groups.find((g) => g._id.equals(c.groupId))?.name ?? "—",
  }));
}
billingRouter.get("/charges", async (req, res) => {
  const q = listInput.parse(req.query),
    filter = await filterFor(req, q);
  const [rows, total] = await Promise.all([
    Charge.find(filter)
      .sort({ billingMonth: -1, _id: -1 })
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize),
    Charge.countDocuments(filter),
  ]);
  res.json({
    charges: await chargeNames(rows, scope(req)),
    total,
    page: q.page,
    pageSize: q.pageSize,
  });
});
billingRouter.get("/charges/:id", async (req, res) => {
  const tenant = scope(req),
    charge = await Charge.findOne({ ...tenant, _id: id(req.params.id) });
  if (!charge) throw missing();
  const adjustments = await ChargeAdjustment.find({
    ...tenant,
    chargeId: charge._id,
  })
    .sort({ createdAt: 1 })
    .lean();
  res.json({ charge: (await chargeNames([charge], tenant))[0], adjustments });
});
billingRouter.patch(
  "/charges/:id",
  requireRoles("business_owner"),
  async (req, res) => {
    const input = z
      .object({
        originalAmount: money,
        discountAmount: money,
        cancelled: z.boolean().default(false),
        reason,
      })
      .strict()
      .parse(req.body);
    if (input.discountAmount > input.originalAmount)
      throw conflict("Chegirma hisobdan oshmasin.");
    const tenant = scope(req);
    const charge = await mongoose.connection.transaction(
      async (session) => {
        await lockBilling(tenant.tenantId, session);
        const c = await Charge.findOne({
          ...tenant,
          _id: id(req.params.id),
        }).session(session);
        if (!c) throw missing();
        c.paidAmount = await paidFor(c, session);
        const finalAmount = input.originalAmount - input.discountAmount;
        if (finalAmount < c.paidAmount || (input.cancelled && c.paidAmount > 0))
          throw conflict(
            "Avval to‘lovni qaytaring. Hisob to‘lovdan kam bo‘lmasin.",
          );
        const before = chargeView(c);
        c.set({
          originalAmount: input.originalAmount,
          discountAmount: input.discountAmount,
          finalAmount,
          cancelled: input.cancelled,
        });
        await c.save({ session });
        await ChargeAdjustment.create(
          [
            {
              ...tenant,
              chargeId: c._id,
              recordedBy: principal(req).userId,
              reason: input.reason,
              before,
              after: chargeView(c),
            },
          ],
          { session },
        );
        return chargeView(c);
      },
      { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
    );
    res.json({ charge });
  },
);
billingRouter.post("/payments", async (req, res) => {
  const input = paymentInput.parse(req.body),
    tenant = scope(req),
    actor = principal(req);
  if (new Date(input.paidAt).getTime() > Date.now())
    throw conflict("Kelajakdagi to‘lov sanasi mumkin emas.");
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        chargeId: input.chargeId.toLowerCase(),
        amount: input.amount,
        method: input.method,
        paidAt: new Date(input.paidAt).toISOString(),
        reference: input.reference ?? "",
        note: input.note ?? "",
        recordedBy: actor.userId.toString(),
      }),
    )
    .digest("hex");
  const result = await mongoose.connection.transaction(
    async (session) => {
      await lockBilling(tenant.tenantId, session);
      const prior = await Payment.findOne({
        ...tenant,
        idempotencyKey: input.idempotencyKey,
      })
        .select("+fingerprint")
        .session(session);
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          throw conflict("Takroriy so‘rov ma’lumotlari mos emas.");
        const r = await PaymentReversal.findOne({
          ...tenant,
          paymentId: prior._id,
        }).session(session);
        return { payment: paymentView(prior, r ?? undefined), replayed: true };
      }
      const c = await Charge.findOne({
        ...tenant,
        _id: input.chargeId,
        cancelled: false,
      }).session(session);
      if (!c) throw missing();
      c.paidAmount = await paidFor(c, session);
      if (input.amount > c.finalAmount - c.paidAmount)
        throw conflict("To‘lov qolgan summadan oshmasin.");
      const [p] = await Payment.create(
        [
          {
            ...tenant,
            studentId: c.studentId,
            chargeId: c._id,
            amount: input.amount,
            method: input.method,
            paidAt: input.paidAt,
            reference: input.reference,
            note: input.note,
            recordedBy: actor.userId,
            idempotencyKey: input.idempotencyKey,
            fingerprint,
          },
        ],
        { session },
      );
      c.paidAmount += input.amount;
      await c.save({ session });
      return { payment: paymentView(p!), replayed: false };
    },
    { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
  );
  res.status(result.replayed ? 200 : 201).json(result);
});
billingRouter.post(
  "/payments/:id/reverse",
  requireRoles("business_owner"),
  async (req, res) => {
    const input = z
        .object({ reason, confirmed: z.literal(true) })
        .strict()
        .parse(req.body),
      tenant = scope(req);
    const payment = await mongoose.connection.transaction(
      async (session) => {
        await lockBilling(tenant.tenantId, session);
        const p = await Payment.findOne({
          ...tenant,
          _id: id(req.params.id),
        }).session(session);
        if (!p) throw missing();
        const existing = await PaymentReversal.findOne({
          ...tenant,
          paymentId: p._id,
        }).session(session);
        if (existing) {
          if (existing.reason !== input.reason)
            throw conflict("To‘lov allaqachon qaytarilgan.");
          return paymentView(p, existing);
        }
        const c = await Charge.findOne({ ...tenant, _id: p.chargeId }).session(
          session,
        );
        if (!c) throw missing();
        const [r] = await PaymentReversal.create(
          [
            {
              ...tenant,
              paymentId: p._id,
              recordedBy: principal(req).userId,
              reason: input.reason,
            },
          ],
          { session },
        );
        c.paidAmount = await paidFor(c, session);
        await c.save({ session });
        return paymentView(p, r!);
      },
      { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
    );
    res.json({ payment });
  },
);
async function listPayments(req: Request, student?: string) {
  const q = listInput
      .omit({ status: true })
      .extend({
        chargeId: z
          .string()
          .regex(/^[a-f\d]{24}$/i)
          .optional(),
      })
      .parse(req.query),
    tenant = scope(req);
  if (student && !(await Student.exists({ ...tenant, _id: student })))
    throw missing();
  const { month: _month, ...chargeQuery } = q;
  const chargeFilter = await filterFor(req, {
    ...chargeQuery,
    studentId: student ?? q.studentId,
  });
  const charges = await Charge.find(chargeFilter).select("_id");
  const filter = {
    ...tenant,
    chargeId: q.chargeId
      ? {
          $in: charges
            .filter((c) => c._id.toString() === q.chargeId)
            .map((c) => c._id),
        }
      : { $in: charges.map((c) => c._id) },
    ...(q.month
      ? {
          paidAt: {
            $gte: monthBounds(q.month).start,
            $lt: monthBounds(q.month).end,
          },
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    Payment.find(filter)
      .sort({ paidAt: -1, _id: -1 })
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize),
    Payment.countDocuments(filter),
  ]);
  const reversals = await PaymentReversal.find({
    ...tenant,
    paymentId: { $in: rows.map((p) => p._id) },
  });
  const students = await Student.find({
    ...tenant,
    _id: { $in: rows.map((p) => p.studentId) },
  }).select("firstName lastName");
  return {
    payments: rows.map((p) => {
      const student = students.find((s) => s._id.equals(p.studentId));
      return {
        ...paymentView(
          p,
          reversals.find((r) => r.paymentId.equals(p._id)),
        ),
        studentName: student ? `${student.firstName} ${student.lastName}` : "—",
      };
    }),
    total,
    page: q.page,
    pageSize: q.pageSize,
  };
}
billingRouter.get("/payments", async (req, res) =>
  res.json(await listPayments(req)),
);
billingRouter.get("/students/:id/history", async (req, res) =>
  res.json(await listPayments(req, id(req.params.id))),
);
export async function billingSummary(
  tenant: ReturnType<typeof scope>,
  month = currentBillingMonth(),
) {
  const { start, end } = monthBounds(month);
  return mongoose.connection.transaction(
    async (session) => {
      const charges = await Charge.find({
        ...tenant,
        billingMonth: month,
        cancelled: false,
      }).session(session);
      const payments = await Payment.find({
        ...tenant,
        paidAt: { $gte: start, $lt: end },
      }).session(session);
      const reversals = await PaymentReversal.find({
        ...tenant,
        paymentId: { $in: payments.map((p) => p._id) },
      }).session(session);
      const valid = payments.filter(
        (p) => !reversals.some((r) => r.paymentId.equals(p._id)),
      );
      const billedAmount = charges.reduce((sum, c) => sum + c.finalAmount, 0),
        receivedAmount = valid.reduce((sum, p) => sum + p.amount, 0),
        outstandingAmount = charges.reduce(
          (sum, c) => sum + (c.finalAmount - c.paidAmount),
          0,
        );
      if (
        ![billedAmount, receivedAmount, outstandingAmount].every(
          Number.isSafeInteger,
        )
      )
        throw new AppError(
          422,
          "TOTAL_LIMIT",
          "Hisobot summasi chegaradan oshdi.",
        );
      return {
        month,
        timezone: "Asia/Tashkent",
        billedAmount,
        receivedAmount,
        outstandingAmount,
        paymentCount: valid.length,
      };
    },
    { readConcern: { level: "snapshot" } },
  );
}
billingRouter.get("/summary", async (req, res) => {
  const q = z
    .object({ month: billingMonth.default(currentBillingMonth()) })
    .strict()
    .parse(req.query);
  res.json(await billingSummary(scope(req), q.month));
});
