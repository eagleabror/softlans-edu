import { Router, type Request } from "express";
import mongoose, { type ClientSession } from "mongoose";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  SalaryRule,
  Payroll,
  SalaryPayout,
  SalaryPayoutReversal,
  PayrollAudit,
} from "./payroll-models.js";
import { User } from "./models.js";
import { Group } from "./group-models.js";
import { principal, requireRoles, tenantScope } from "./security.js";
import { lockBilling } from "./billing-lock.js";
import {
  billingMonth,
  currentBillingMonth,
  money,
  reason,
} from "./billing-validation.js";
import { calculatePayroll, safeTotal } from "./payroll-calculation.js";
import { AppError } from "./errors.js";
const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const missing = () => new AppError(404, "NOT_FOUND", "Ma’lumot topilmadi.");
const conflict = () =>
  new AppError(
    409,
    "PAYROLL_CONFLICT",
    "Ma’lumotlar o‘zgargan yoki amal mumkin emas. Yangilab tekshiring.",
  );
const owner = requireRoles("business_owner");
const scope = (req: Request) => tenantScope(principal(req));
const calculation = z
  .object({ teacherId: objectId, month: billingMonth })
  .strict();
const confirm = z
  .object({
    confirmed: z.literal(true),
    revision: z.number().int().nonnegative(),
  })
  .strict();
const ruleInput = z
  .object({
    teacherId: objectId,
    groupId: objectId.nullable().default(null),
    salaryType: z.enum(["collected", "billed", "fixed"]),
    percentage: z
      .number()
      .min(0)
      .max(100)
      .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-8)
      .nullable()
      .default(null),
    fixedAmount: money.nullable().default(null),
    effectiveFrom: z.iso
      .date()
      .refine((d) => d.endsWith("-01"), "Oy boshini tanlang."),
    effectiveUntil: z.iso.date().nullable().default(null),
    reason,
  })
  .strict()
  .superRefine((q, ctx) => {
    if (q.effectiveUntil && q.effectiveUntil < q.effectiveFrom)
      ctx.addIssue({
        code: "custom",
        path: ["effectiveUntil"],
        message: "Tugash sanasi boshlanish sanasidan oldin bo‘lmasin.",
      });
    if (q.salaryType === "fixed") {
      if (q.fixedAmount === null)
        ctx.addIssue({
          code: "custom",
          path: ["fixedAmount"],
          message: "Belgilangan summani kiriting.",
        });
      if (q.percentage !== null)
        ctx.addIssue({
          code: "custom",
          path: ["percentage"],
          message: "Belgilangan oylik uchun foiz kiritilmaydi.",
        });
    } else {
      if (q.percentage === null)
        ctx.addIssue({
          code: "custom",
          path: ["percentage"],
          message: "Foizni kiriting.",
        });
      if (q.fixedAmount !== null)
        ctx.addIssue({
          code: "custom",
          path: ["fixedAmount"],
          message: "Foizli maosh uchun belgilangan summa kiritilmaydi.",
        });
    }
  });
const listing = z
  .object({
    month: billingMonth.default(currentBillingMonth),
    teacherId: objectId.optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
async function locked<T>(req: Request, fn: (tx: ClientSession) => Promise<T>) {
  return mongoose.connection.transaction(
    async (tx) => {
      await lockBilling(scope(req).tenantId, tx);
      return fn(tx);
    },
    { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
  );
}
async function audit(
  req: Request,
  tx: ClientSession,
  entityId: mongoose.Types.ObjectId,
  action: string,
  why: string,
  before?: unknown,
  after?: unknown,
) {
  await PayrollAudit.create(
    [
      {
        ...scope(req),
        recordedBy: principal(req).userId,
        entityId,
        action,
        reason: why,
        before,
        after,
      },
    ],
    { session: tx },
  );
}
async function teacher(req: Request, teacherId: string, tx: ClientSession) {
  if (
    !(await User.exists({
      ...scope(req),
      _id: teacherId,
      role: "teacher",
    }).session(tx))
  )
    throw missing();
}
function visibility(req: Request) {
  return {
    ...scope(req),
    ...(principal(req).role === "teacher"
      ? { teacherId: principal(req).userId, status: { $ne: "draft" } }
      : {}),
  };
}
async function findPayroll(req: Request, tx?: ClientSession) {
  const p = await Payroll.findOne({
    ...visibility(req),
    _id: objectId.parse(req.params.id),
  }).session(tx ?? null);
  if (!p) throw missing();
  return p;
}
function view(p: InstanceType<typeof Payroll>, self = false) {
  const raw = p.toObject();
  return {
    id: p.id,
    teacherId: String(p.teacherId),
    payrollMonth: p.payrollMonth,
    calculationBasis: self
      ? {
          ...raw.calculationBasis,
          lines: raw.calculationBasis.lines.map(
            (l: Record<string, unknown>) => ({ ...l, sourceIds: undefined }),
          ),
        }
      : raw.calculationBasis,
    grossSalary: p.grossSalary,
    adjustments: raw.adjustments,
    finalSalary: p.finalSalary,
    paidAmount: p.paidAmount,
    outstandingAmount:
      p.status === "draft" || p.reversedAt ? 0 : p.finalSalary - p.paidAmount,
    status: p.status,
    reversedAt: p.reversedAt,
    calculatedAt: p.calculatedAt,
    approvedBy: p.approvedBy,
    approvedAt: p.approvedAt,
    revision: p.revision,
  };
}
export const payrollRouter = Router();
payrollRouter.use(requireRoles("business_owner", "teacher"));
payrollRouter.get("/rules", owner, async (req, res) => {
  const q = listing.omit({ month: true }).parse(req.query);
  const filter = {
    ...scope(req),
    archived: false,
    ...(q.teacherId ? { teacherId: q.teacherId } : {}),
  };
  res.json({
    rules: await SalaryRule.find(filter)
      .sort({ effectiveFrom: -1, _id: 1 })
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize),
    total: await SalaryRule.countDocuments(filter),
  });
});
for (const method of ["post", "put"] as const)
  payrollRouter[method](
    method === "post" ? "/rules" : "/rules/:id",
    owner,
    async (req, res) => {
      const input = ruleInput.parse(req.body);
      const result = await locked(req, async (tx) => {
        await teacher(req, input.teacherId, tx);
        if (
          input.groupId &&
          !(await Group.exists({ ...scope(req), _id: input.groupId }).session(
            tx,
          ))
        )
          throw missing();
        const existing =
          method === "put"
            ? await SalaryRule.findOne({
                ...scope(req),
                _id: objectId.parse(req.params.id),
                archived: false,
              }).session(tx)
            : null;
        if (method === "put" && !existing) throw missing();
        if (
          existing &&
          (String(existing.teacherId) !== input.teacherId ||
            String(existing.groupId ?? "") !== (input.groupId ?? ""))
        )
          throw conflict();
        const overlap = await SalaryRule.exists({
          ...scope(req),
          teacherId: input.teacherId,
          groupId: input.groupId,
          archived: false,
          ...(existing ? { _id: { $ne: existing._id } } : {}),
          effectiveFrom: { $lte: input.effectiveUntil ?? "9999-12-31" },
          $or: [
            { effectiveUntil: null },
            { effectiveUntil: { $gte: input.effectiveFrom } },
          ],
        }).session(tx);
        if (overlap) throw conflict();
        const before = existing?.toObject();
        const { reason: why, ...data } = input;
        const r =
          existing ??
          new SalaryRule({
            ...scope(req),
            ...data,
            createdBy: principal(req).userId,
          });
        r.set(data);
        await r.save({ session: tx });
        await audit(
          req,
          tx,
          r._id,
          existing ? "rule_updated" : "rule_created",
          why,
          before,
          r.toObject(),
        );
        return r;
      });
      res.status(method === "post" ? 201 : 200).json({ rule: result });
    },
  );
payrollRouter.delete("/rules/:id", owner, async (req, res) => {
  const q = z.object({ reason }).strict().parse(req.body);
  await locked(req, async (tx) => {
    const r = await SalaryRule.findOne({
      ...scope(req),
      _id: objectId.parse(req.params.id),
      archived: false,
    }).session(tx);
    if (!r) throw missing();
    const before = r.toObject();
    r.archived = true;
    await r.save({ session: tx });
    await audit(
      req,
      tx,
      r._id,
      "rule_archived",
      q.reason,
      before,
      r.toObject(),
    );
  });
  res.status(204).end();
});
payrollRouter.post("/preview", owner, async (req, res) => {
  const q = calculation.parse(req.body);
  res.json(
    await locked(req, async (tx) => {
      await teacher(req, q.teacherId, tx);
      return calculatePayroll(scope(req).tenantId, q.teacherId, q.month, tx);
    }),
  );
});
payrollRouter.post("/drafts", owner, async (req, res) => {
  const q = calculation.extend({ confirmed: z.literal(true) }).parse(req.body);
  const p = await locked(req, async (tx) => {
    await teacher(req, q.teacherId, tx);
    const prior = await Payroll.findOne({
      ...scope(req),
      teacherId: q.teacherId,
      payrollMonth: q.month,
    }).session(tx);
    if (prior) return prior; // Stable replay; recalculation is an explicit action.
    const basis = await calculatePayroll(
      scope(req).tenantId,
      q.teacherId,
      q.month,
      tx,
    );
    const [p] = await Payroll.create(
      [
        {
          ...scope(req),
          teacherId: q.teacherId,
          payrollMonth: q.month,
          calculationBasis: basis,
          grossSalary: basis.grossSalary,
          finalSalary: basis.grossSalary,
          calculatedAt: new Date(),
          createdBy: principal(req).userId,
        },
      ],
      { session: tx },
    );
    await audit(
      req,
      tx,
      p!._id,
      "draft_created",
      "Oylik hisob-kitob",
      undefined,
      view(p!),
    );
    return p!;
  });
  res.json({ payroll: view(p) });
});
payrollRouter.post("/:id/recalculate", owner, async (req, res) => {
  const q = confirm.extend({ reason }).parse(req.body);
  const p = await locked(req, async (tx) => {
    const p = await findPayroll(req, tx);
    if (p.status !== "draft" || p.revision !== q.revision) throw conflict();
    const before = view(p);
    const basis = await calculatePayroll(
      scope(req).tenantId,
      String(p.teacherId),
      p.payrollMonth,
      tx,
    );
    p.calculationBasis = basis;
    p.grossSalary = basis.grossSalary;
    p.finalSalary = safeTotal([
      p.grossSalary,
      ...p.adjustments.map((a) => a.amount as number),
    ]);
    p.calculatedAt = new Date();
    p.revision++;
    await p.save({ session: tx });
    await audit(req, tx, p._id, "recalculated", q.reason, before, view(p));
    return p;
  });
  res.json({ payroll: view(p) });
});
payrollRouter.post("/:id/adjustments", owner, async (req, res) => {
  const q = z
    .object({
      revision: z.number().int().nonnegative(),
      amount: z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000),
      reason,
    })
    .strict()
    .parse(req.body);
  const p = await locked(req, async (tx) => {
    const p = await findPayroll(req, tx);
    if (p.status !== "draft" || p.revision !== q.revision) throw conflict();
    const before = view(p);
    p.finalSalary = safeTotal([p.finalSalary, q.amount]);
    p.adjustments.push({
      amount: q.amount,
      reason: q.reason,
      recordedBy: String(principal(req).userId),
      createdAt: new Date().toISOString(),
    });
    p.revision++;
    await p.save({ session: tx });
    await audit(req, tx, p._id, "adjusted", q.reason, before, view(p));
    return p;
  });
  res.json({ payroll: view(p) });
});
payrollRouter.post("/:id/approve", owner, async (req, res) => {
  const q = confirm.parse(req.body);
  const p = await locked(req, async (tx) => {
    const p = await findPayroll(req, tx);
    if (p.status !== "draft" || p.revision !== q.revision) throw conflict();
    p.status = p.finalSalary === 0 ? "paid" : "approved";
    p.approvedBy = principal(req).userId;
    p.approvedAt = new Date();
    p.revision++;
    await p.save({ session: tx });
    await audit(
      req,
      tx,
      p._id,
      "approved",
      "Maosh tasdiqlandi",
      undefined,
      view(p),
    );
    return p;
  });
  res.json({ payroll: view(p) });
});
async function payoutTotal(
  req: Request,
  payrollId: mongoose.Types.ObjectId,
  tx: ClientSession,
) {
  const ps = await SalaryPayout.find({ ...scope(req), payrollId }).session(tx);
  const rs = await SalaryPayoutReversal.find({
    ...scope(req),
    payoutId: { $in: ps.map((p) => p._id) },
  }).session(tx);
  return safeTotal(
    ps
      .filter((p) => !rs.some((r) => r.payoutId.equals(p._id)))
      .map((p) => p.amount),
  );
}
payrollRouter.post("/:id/payouts", owner, async (req, res) => {
  const q = z
    .object({
      amount: money.min(1),
      paidAt: z.iso.datetime({ offset: true }),
      method: z.enum(["cash", "bank_transfer"]),
      reference: z.string().trim().max(200).default(""),
      idempotencyKey: z.string().uuid(),
      confirmed: z.literal(true),
    })
    .strict()
    .parse(req.body);
  if (new Date(q.paidAt).getTime() > Date.now()) throw conflict();
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        ...q,
        paidAt: new Date(q.paidAt).toISOString(),
        payrollId: objectId.parse(req.params.id).toLowerCase(),
        actor: String(principal(req).userId),
      }),
    )
    .digest("hex");
  const result = await locked(req, async (tx) => {
    const p = await findPayroll(req, tx);
    const prior = await SalaryPayout.findOne({
      ...scope(req),
      idempotencyKey: q.idempotencyKey,
    })
      .select("+fingerprint")
      .session(tx);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw conflict();
      return { id: prior.id, replayed: true };
    }
    if (p.status === "draft" || p.reversedAt) throw conflict();
    p.paidAmount = await payoutTotal(req, p._id, tx);
    if (q.amount > p.finalSalary - p.paidAmount) throw conflict();
    const [pay] = await SalaryPayout.create(
      [
        {
          ...scope(req),
          ...q,
          confirmed: undefined,
          payrollId: p._id,
          recordedBy: principal(req).userId,
          fingerprint,
        },
      ].map(({ confirmed: _c, ...data }) => data),
      { session: tx },
    );
    p.paidAmount += q.amount;
    p.status = p.paidAmount === p.finalSalary ? "paid" : "partially_paid";
    p.revision++;
    await p.save({ session: tx });
    await audit(req, tx, p._id, "payout_recorded", "Maosh to‘lovi", undefined, {
      payoutId: pay!.id,
      amount: q.amount,
    });
    return { id: pay!.id, replayed: false };
  });
  res.status(result.replayed ? 200 : 201).json(result);
});
payrollRouter.post(
  "/:id/payouts/:payoutId/reverse",
  owner,
  async (req, res) => {
    const q = z
      .object({ reason, confirmed: z.literal(true) })
      .strict()
      .parse(req.body);
    await locked(req, async (tx) => {
      const p = await findPayroll(req, tx);
      const pay = await SalaryPayout.findOne({
        ...scope(req),
        payrollId: p._id,
        _id: objectId.parse(req.params.payoutId),
      }).session(tx);
      if (!pay) throw missing();
      const prior = await SalaryPayoutReversal.findOne({
        ...scope(req),
        payoutId: pay._id,
      }).session(tx);
      if (prior) {
        if (prior.reason !== q.reason) throw conflict();
        return;
      }
      await SalaryPayoutReversal.create(
        [
          {
            ...scope(req),
            payoutId: pay._id,
            recordedBy: principal(req).userId,
            reason: q.reason,
          },
        ],
        { session: tx },
      );
      p.paidAmount = await payoutTotal(req, p._id, tx);
      p.status =
        p.paidAmount === p.finalSalary
          ? "paid"
          : p.paidAmount
            ? "partially_paid"
            : "approved";
      p.revision++;
      await p.save({ session: tx });
      await audit(req, tx, p._id, "payout_reversed", q.reason, {
        payoutId: pay.id,
        amount: pay.amount,
      });
    });
    res.status(204).end();
  },
);
payrollRouter.get("/", async (req, res) => {
  const q = listing.parse(req.query);
  const filter = {
    ...visibility(req),
    payrollMonth: q.month,
    ...(q.teacherId && principal(req).role !== "teacher"
      ? { teacherId: q.teacherId }
      : {}),
  };
  const ps = await Payroll.find(filter)
    .sort({ teacherId: 1 })
    .skip((q.page - 1) * q.pageSize)
    .limit(q.pageSize);
  const names = await User.find({
    ...scope(req),
    _id: { $in: ps.map((p) => p.teacherId) },
  }).select("name");
  res.json({
    payrolls: ps.map((p) => ({
      ...view(p, principal(req).role === "teacher"),
      teacherName: names.find((n) => n._id.equals(p.teacherId))?.name ?? "—",
    })),
    total: await Payroll.countDocuments(filter),
  });
});
payrollRouter.get("/summary", owner, async (req, res) => {
  const q = listing.omit({ page: true, pageSize: true }).parse(req.query);
  res.json(
    await locked(req, async (tx) => {
      const ps = await Payroll.find({
        ...scope(req),
        payrollMonth: q.month,
        reversedAt: null,
        status: { $ne: "draft" },
        ...(q.teacherId ? { teacherId: q.teacherId } : {}),
      }).session(tx);
      const approvedSalary = safeTotal(ps.map((p) => p.finalSalary)),
        paidSalary = safeTotal(ps.map((p) => p.paidAmount));
      const byGroup = new Map<string, number>();
      for (const p of ps)
        for (const line of p.calculationBasis.lines)
          if (line.groupId)
            byGroup.set(
              line.groupId,
              safeTotal([byGroup.get(line.groupId) ?? 0, line.salary]),
            );
      return {
        month: q.month,
        timezone: "Asia/Tashkent",
        approvedSalary,
        paidSalary,
        outstandingSalary: approvedSalary - paidSalary,
        byTeacher: ps.map((p) => ({
          teacherId: String(p.teacherId),
          approvedSalary: p.finalSalary,
          paidSalary: p.paidAmount,
        })),
        byGroup: [...byGroup].map(([groupId, grossSalary]) => ({
          groupId,
          grossSalary,
        })),
        unattributedSalary:
          safeTotal(ps.map((p) => p.finalSalary)) -
          safeTotal([...byGroup.values()]),
        cashPolicy:
          "Payouts net of reversals for the selected payroll month; not a cash-date report.",
      };
    }),
  );
});
payrollRouter.post("/:id/reverse", owner, async (req, res) => {
  const q = z
    .object({ reason, confirmed: z.literal(true) })
    .strict()
    .parse(req.body);
  await locked(req, async (tx) => {
    const p = await findPayroll(req, tx);
    if (p.status === "draft" || (await payoutTotal(req, p._id, tx)) !== 0)
      throw conflict();
    if (p.reversedAt) return;
    p.reversedAt = new Date();
    p.revision++;
    await p.save({ session: tx });
    await audit(
      req,
      tx,
      p._id,
      "payroll_reversed",
      q.reason,
      undefined,
      view(p),
    );
  });
  res.status(204).end();
});
payrollRouter.get("/:id/payouts", async (req, res) => {
  const p = await findPayroll(req);
  const ps = await SalaryPayout.find({ ...scope(req), payrollId: p._id }).sort({
    paidAt: -1,
  });
  const rs = await SalaryPayoutReversal.find({
    ...scope(req),
    payoutId: { $in: ps.map((p) => p._id) },
  });
  res.json({
    payouts: ps.map((p) => ({
      id: p.id,
      amount: p.amount,
      method: p.method,
      reference: p.reference,
      paidAt: p.paidAt,
      recordedBy: p.recordedBy,
      reversal: rs.find((r) => r.payoutId.equals(p._id)) ?? null,
    })),
  });
});
payrollRouter.get("/:id", async (req, res) => {
  const p = await findPayroll(req);
  const name = await User.findOne({ ...scope(req), _id: p.teacherId }).select(
    "name",
  );
  res.json({
    payroll: {
      ...view(p, principal(req).role === "teacher"),
      teacherName: name?.name ?? "—",
    },
    audit:
      principal(req).role === "business_owner"
        ? await PayrollAudit.find({ ...scope(req), entityId: p._id }).sort({
            createdAt: 1,
          })
        : undefined,
  });
});
