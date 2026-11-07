import { Router, type Request } from "express";
import mongoose, { type ClientSession } from "mongoose";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  ExpenseCategory,
  Expense,
  CashAccount,
  CashMovement,
  CashOperation,
  CashAudit,
} from "./cash-models.js";
import { Payment, PaymentReversal } from "./billing-models.js";
import { SalaryPayout, SalaryPayoutReversal } from "./payroll-models.js";
import { principal, requireRoles, tenantScope } from "./security.js";
import { lockBilling } from "./billing-lock.js";
import { money, reason } from "./billing-validation.js";
import { objectId } from "./group-validation.js";
import {
  cashDay,
  cashBalance,
  postCash,
  cashAudit,
  cashConflict,
  cashMissing,
  exactSum,
} from "./cash-service.js";
const scope = (req: Request) => tenantScope(principal(req));
const owner = requireRoles("business_owner");
const text = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine((v) => !/[\u0000-\u001f\u007f]/.test(v));
const date = z.iso
  .date()
  .refine((v) => v <= cashDay(), "Kelajak sanasi mumkin emas.");
const confirmation = z.object({
  idempotencyKey: z.string().uuid(),
  confirmed: z.literal(true),
});
const expenseInput = z
  .object({
    amount: money.min(1),
    categoryId: objectId,
    accountId: objectId,
    description: reason,
    expenseDate: date,
    method: z.enum(["cash", "bank_transfer"]),
    supplier: z.string().trim().max(200).default(""),
    reference: z.string().trim().max(200).default(""),
    idempotencyKey: z.string().uuid(),
  })
  .strict();
const listing = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    accountId: objectId.optional(),
    categoryId: objectId.optional(),
    status: z.enum(["draft", "confirmed", "voided"]).optional(),
  })
  .strict()
  .refine(
    (q) => !q.from || !q.to || q.from <= q.to,
    "Sana oralig‘ini tekshiring.",
  );
const publicView = (r: {
  toObject(): object;
  _id: mongoose.Types.ObjectId;
}) => ({ ...r.toObject(), id: String(r._id) });
async function locked<T>(req: Request, fn: (tx: ClientSession) => Promise<T>) {
  return mongoose.connection.transaction(
    async (tx) => {
      await lockBilling(scope(req).tenantId, tx);
      return fn(tx);
    },
    { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
  );
}
async function operation(
  req: Request,
  input: { idempotencyKey: string },
  fn: (tx: ClientSession) => Promise<object>,
) {
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        path: req.path,
        actor: String(principal(req).userId),
        input,
      }),
    )
    .digest("hex");
  return locked(req, async (tx) => {
    const prior = await CashOperation.findOne({
      ...scope(req),
      key: input.idempotencyKey,
    }).session(tx);
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        throw cashConflict("Takroriy so‘rov ma’lumotlari mos emas.");
      return { ...prior.result, replayed: true };
    }
    const result = await fn(tx);
    await CashOperation.create(
      [
        {
          ...scope(req),
          recordedBy: principal(req).userId,
          key: input.idempotencyKey,
          fingerprint,
          result,
        },
      ],
      { session: tx },
    );
    return { ...result, replayed: false };
  });
}
async function audit(
  req: Request,
  tx: ClientSession,
  entityId: string,
  action: string,
  why: string,
  before?: unknown,
  after?: unknown,
) {
  await cashAudit(
    scope(req).tenantId,
    principal(req).userId,
    entityId,
    action,
    why,
    tx,
    before,
    after,
  );
}
export const cashRouter = Router();
cashRouter.use(requireRoles("business_owner", "admin"));
// Explicitly permitted minimal draft metadata. No balances or other users' records.
cashRouter.get("/draft-options", async (req, res) => {
  const categories = await ExpenseCategory.find({
    ...scope(req),
    ...(principal(req).role === "admin" ? { active: true } : {}),
  })
    .select("name active")
    .sort({ name: 1 });
  const accounts = await CashAccount.find({
    ...scope(req),
    ...(principal(req).role === "admin" ? { active: true } : {}),
  })
    .select("name kind active")
    .sort({ name: 1 });
  res.json({
    categories: categories.map(publicView),
    accounts: accounts.map(publicView),
  });
});
cashRouter.post("/setup", owner, async (req, res) => {
  const q = confirmation.extend({ reason }).strict().parse(req.body);
  res.json(
    await operation(req, q, async (tx) => {
      for (const name of [
        "Ijara",
        "Kommunal xizmatlar",
        "Internet va aloqa",
        "Reklama va marketing",
        "Ofis va xo‘jalik xarajatlari",
        "Ta’mirlash",
        "Uskunalar",
        "Boshqa xarajatlar",
      ]) {
        if (
          !(await ExpenseCategory.exists({ ...scope(req), name }).session(tx))
        ) {
          const [c] = await ExpenseCategory.create(
            [{ ...scope(req), name, createdBy: principal(req).userId }],
            { session: tx },
          );
          await audit(
            req,
            tx,
            c!.id,
            "category_created",
            "Boshlang‘ich sozlash",
            undefined,
            c!.toObject(),
          );
        }
      }
      for (const [name, kind] of [
        ["Naqd kassa", "cash"],
        ["Bank hisobi", "bank"],
      ]) {
        if (!(await CashAccount.exists({ ...scope(req), name }).session(tx))) {
          const [a] = await CashAccount.create(
            [{ ...scope(req), name, kind, createdBy: principal(req).userId }],
            { session: tx },
          );
          await audit(
            req,
            tx,
            a!.id,
            "account_created",
            "Boshlang‘ich sozlash",
            undefined,
            a!.toObject(),
          );
        }
      }
      return { initialized: true };
    }),
  );
});
type NamedRecord = {
  name: string;
  active: boolean;
  tenantId: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
  kind?: string;
  openingDate?: string | null;
};
for (const [path, sourceModel] of [
  ["categories", ExpenseCategory],
  ["accounts", CashAccount],
] as const) {
  const Model = sourceModel as unknown as mongoose.Model<NamedRecord>;
  cashRouter.get(`/${path}`, owner, async (req, res) => {
    z.object({}).strict().parse(req.query);
    res.json({
      rows: (await Model.find(scope(req)).sort({ name: 1 })).map(publicView),
    });
  });
  cashRouter.post(`/${path}`, owner, async (req, res) => {
    const q = z
      .object({
        name: text,
        ...(path === "accounts"
          ? { kind: z.enum(["cash", "bank", "manual"]) }
          : {}),
        reason,
        idempotencyKey: z.string().uuid(),
      })
      .strict()
      .parse(req.body);
    res.status(201).json(
      await operation(req, q, async (tx) => {
        const { reason: why, idempotencyKey: _k, ...fields } = q;
        const [r] = await Model.create(
          [{ ...scope(req), ...fields, createdBy: principal(req).userId }],
          { session: tx },
        );
        await audit(
          req,
          tx,
          r!.id,
          `${path}_created`,
          why,
          undefined,
          r!.toObject(),
        );
        return { row: publicView(r!) };
      }),
    );
  });
  cashRouter.patch(`/${path}/:id`, owner, async (req, res) => {
    const q = z
      .object({
        name: text,
        active: z.boolean(),
        reason,
        idempotencyKey: z.string().uuid(),
      })
      .strict()
      .parse(req.body);
    res.json(
      await operation(req, q, async (tx) => {
        const r = await Model.findOne({
          ...scope(req),
          _id: objectId.parse(req.params.id),
        }).session(tx);
        if (!r) throw cashMissing();
        const before = r.toObject();
        r.set({ name: q.name, active: q.active });
        await r.save({ session: tx });
        await audit(
          req,
          tx,
          r.id,
          `${path}_updated`,
          q.reason,
          before,
          r.toObject(),
        );
        return { row: publicView(r) };
      }),
    );
  });
}
cashRouter.post("/accounts/:id/opening", owner, async (req, res) => {
  const q = confirmation
    .extend({ amount: money, date, reason })
    .strict()
    .parse(req.body);
  res.json(
    await operation(req, q, async (tx) => {
      const a = await CashAccount.findOne({
        ...scope(req),
        _id: objectId.parse(req.params.id),
        active: true,
      }).session(tx);
      if (!a) throw cashMissing();
      if (a.openingDate)
        throw cashConflict("Boshlang‘ich qoldiq allaqachon belgilangan.");
      a.openingDate = q.date;
      await a.save({ session: tx });
      const r = await postCash(
        {
          ...scope(req),
          recordedBy: principal(req).userId,
          accountId: a._id,
          delta: q.amount,
          date: q.date,
          kind: "opening",
          sourceId: a.id,
          reason: q.reason,
          opening: true,
        },
        tx,
      );
      return { movement: publicView(r) };
    }),
  );
});
cashRouter.post("/expenses", async (req, res) => {
  const q = expenseInput.parse(req.body);
  res.status(201).json(
    await operation(req, q, async (tx) => {
      if (
        !(await ExpenseCategory.exists({
          ...scope(req),
          _id: q.categoryId,
          active: true,
        }).session(tx)) ||
        !(await CashAccount.exists({
          ...scope(req),
          _id: q.accountId,
          active: true,
        }).session(tx))
      )
        throw cashMissing();
      const { idempotencyKey: _k, ...fields } = q;
      const [e] = await Expense.create(
        [{ ...scope(req), ...fields, createdBy: principal(req).userId }],
        { session: tx },
      );
      await audit(
        req,
        tx,
        e!.id,
        "expense_draft",
        "Xarajat qoralamasi",
        undefined,
        e!.toObject(),
      );
      return { expense: publicView(e!) };
    }),
  );
});
cashRouter.get("/expenses", async (req, res) => {
  const q = listing.parse(req.query);
  const filter = {
    ...scope(req),
    ...(principal(req).role === "admin"
      ? { createdBy: principal(req).userId, status: "draft" }
      : q.status
        ? { status: q.status }
        : {}),
    ...(q.categoryId ? { categoryId: q.categoryId } : {}),
    ...(q.accountId ? { accountId: q.accountId } : {}),
    ...(q.from || q.to
      ? {
          expenseDate: {
            ...(q.from ? { $gte: q.from } : {}),
            ...(q.to ? { $lte: q.to } : {}),
          },
        }
      : {}),
  };
  res.json({
    rows: (
      await Expense.find(filter)
        .sort({ expenseDate: -1, _id: -1 })
        .skip((q.page - 1) * q.pageSize)
        .limit(q.pageSize)
    ).map(publicView),
    total: await Expense.countDocuments(filter),
  });
});
cashRouter.get("/expenses/:id", async (req, res) => {
  const e = await Expense.findOne({
    ...scope(req),
    _id: objectId.parse(req.params.id),
    ...(principal(req).role === "admin"
      ? { createdBy: principal(req).userId, status: "draft" }
      : {}),
  });
  if (!e) throw cashMissing();
  res.json({
    expense: publicView(e),
    audit: (
      await CashAudit.find({ ...scope(req), entityId: e.id }).sort({
        createdAt: 1,
      })
    ).map(publicView),
  });
});
for (const action of ["confirm", "void"] as const)
  cashRouter.post(`/expenses/:id/${action}`, owner, async (req, res) => {
    const q = confirmation.extend({ reason }).strict().parse(req.body);
    res.json(
      await operation(req, q, async (tx) => {
        const e = await Expense.findOne({
          ...scope(req),
          _id: objectId.parse(req.params.id),
        }).session(tx);
        if (!e) throw cashMissing();
        const before = e.toObject();
        if (action === "confirm") {
          if (e.status !== "draft")
            throw cashConflict("Faqat qoralamani tasdiqlash mumkin.");
          if (
            !(await ExpenseCategory.exists({
              ...scope(req),
              _id: e.categoryId,
              active: true,
            }).session(tx))
          )
            throw cashConflict("Kategoriya faol emas.");
          await postCash(
            {
              ...scope(req),
              recordedBy: principal(req).userId,
              accountId: e.accountId,
              delta: -e.amount,
              date: e.expenseDate,
              kind: "expense",
              sourceId: e.id,
              reason: q.reason,
              method: e.method,
            },
            tx,
          );
          e.status = "confirmed";
        } else {
          if (e.status === "voided")
            throw cashConflict("Xarajat allaqachon bekor qilingan.");
          if (e.status === "confirmed")
            await postCash(
              {
                ...scope(req),
                recordedBy: principal(req).userId,
                accountId: e.accountId,
                delta: e.amount,
                date: cashDay(),
                kind: "expense_void",
                sourceId: e.id,
                reason: q.reason,
                reversal: true,
              },
              tx,
            );
          e.status = "voided";
        }
        await e.save({ session: tx });
        await audit(
          req,
          tx,
          e.id,
          `expense_${action}`,
          q.reason,
          before,
          e.toObject(),
        );
        return { expense: publicView(e) };
      }),
    );
  });
cashRouter.post("/movements", owner, async (req, res) => {
  const q = confirmation
    .extend({
      accountId: objectId,
      toAccountId: objectId.optional(),
      amount: money.min(1),
      date,
      kind: z.enum(["manual_in", "manual_out", "transfer"]),
      reason,
    })
    .strict()
    .parse(req.body);
  if (
    (q.kind === "transfer") !== !!q.toAccountId ||
    q.accountId === q.toAccountId
  )
    throw cashConflict("O‘tkazma uchun ikki xil hisobni tanlang.");
  res.status(201).json(
    await operation(req, q, async (tx) => {
      const base = {
        ...scope(req),
        recordedBy: principal(req).userId,
        sourceId: q.idempotencyKey,
        date: q.date,
        kind: q.kind,
        reason: q.reason,
      };
      const a = await postCash(
        {
          ...base,
          accountId: q.accountId,
          delta: q.kind === "manual_in" ? q.amount : -q.amount,
        },
        tx,
      );
      if (q.toAccountId)
        await postCash(
          { ...base, accountId: q.toAccountId, delta: q.amount },
          tx,
        );
      return { movement: publicView(a) };
    }),
  );
});
cashRouter.post("/movements/:id/void", owner, async (req, res) => {
  const q = confirmation.extend({ reason }).strict().parse(req.body);
  res.json(
    await operation(req, q, async (tx) => {
      const m = await CashMovement.findOne({
        ...scope(req),
        _id: objectId.parse(req.params.id),
        kind: { $in: ["manual_in", "manual_out", "transfer"] },
      }).session(tx);
      if (!m) throw cashMissing();
      if (
        await CashMovement.exists({
          ...scope(req),
          kind: "movement_void",
          sourceId: m.sourceId,
        }).session(tx)
      )
        throw cashConflict("Harakat allaqachon bekor qilingan.");
      const rows = await CashMovement.find({
        ...scope(req),
        sourceId: m.sourceId,
        kind: m.kind,
      }).session(tx);
      for (const r of rows)
        await postCash(
          {
            ...scope(req),
            recordedBy: principal(req).userId,
            accountId: r.accountId,
            delta: -r.delta,
            date: cashDay(),
            kind: "movement_void",
            sourceId: r.sourceId,
            reason: q.reason,
            reversal: true,
          },
          tx,
        );
      return { voided: true };
    }),
  );
});
cashRouter.get("/movements", owner, async (req, res) => {
  const q = listing.parse(req.query);
  const filter = {
    ...scope(req),
    ...(q.accountId ? { accountId: q.accountId } : {}),
    ...(q.from || q.to
      ? {
          date: {
            ...(q.from ? { $gte: q.from } : {}),
            ...(q.to ? { $lte: q.to } : {}),
          },
        }
      : {}),
  };
  res.json({
    rows: (
      await CashMovement.find(filter)
        .sort({ date: -1, _id: -1 })
        .skip((q.page - 1) * q.pageSize)
        .limit(q.pageSize)
    ).map(publicView),
    total: await CashMovement.countDocuments(filter),
  });
});
cashRouter.get("/daily", owner, async (req, res) => {
  const q = z
    .object({
      date: z.iso.date().default(cashDay),
      accountId: objectId.optional(),
    })
    .strict()
    .parse(req.query);
  res.json(
    await mongoose.connection.transaction(
      async (tx) => {
        const accounts = await CashAccount.find({
          ...scope(req),
          ...(q.accountId ? { _id: q.accountId } : {}),
        }).session(tx);
        const rows = [];
        for (const a of accounts) {
          const entries = await CashMovement.find({
            ...scope(req),
            accountId: a._id,
            date: q.date,
          }).session(tx);
          const opening = await cashBalance(
            scope(req).tenantId,
            a._id,
            tx,
            q.date,
          );
          const inflow = exactSum(
            entries.filter((e) => e.delta > 0).map((e) => e.delta),
          );
          const outflow = exactSum(
            entries.filter((e) => e.delta < 0).map((e) => -e.delta),
          );
          rows.push({
            ...publicView(a),
            opening,
            inflow,
            outflow,
            closing: exactSum([opening, inflow, -outflow]),
            confirmedBalance: await cashBalance(scope(req).tenantId, a._id, tx),
            complete: !!a.openingDate && a.openingDate <= q.date,
          });
        }
        // Read only reconciliation: legacy sources are never rewritten or assigned.
        const unallocated: Record<string, { count: number; amount: number }> =
          {};
        for (const kind of ["payment", "salary"] as const) {
          const allocated = await CashMovement.find({ ...scope(req), kind })
            .select("sourceId")
            .session(tx);
          const ids = allocated.map(
            (m) => new mongoose.Types.ObjectId(m.sourceId),
          );
          const reversed =
            kind === "payment"
              ? await PaymentReversal.find(scope(req))
                  .select("paymentId")
                  .session(tx)
              : await SalaryPayoutReversal.find(scope(req))
                  .select("payoutId")
                  .session(tx);
          const reversedIds = reversed.map((r) =>
            "paymentId" in r ? r.paymentId : r.payoutId,
          );
          const sources =
            kind === "payment"
              ? await Payment.find({
                  ...scope(req),
                  _id: { $nin: [...ids, ...reversedIds] },
                })
                  .select("amount")
                  .session(tx)
              : await SalaryPayout.find({
                  ...scope(req),
                  _id: { $nin: [...ids, ...reversedIds] },
                })
                  .select("amount")
                  .session(tx);
          unallocated[kind] = {
            count: sources.length,
            amount: exactSum(sources.map((s) => s.amount)),
          };
        }
        return { date: q.date, timezone: "Asia/Tashkent", rows, unallocated };
      },
      { readConcern: { level: "snapshot" } },
    ),
  );
});
cashRouter.get("/audit/:id", owner, async (req, res) => {
  const entityId = z.string().max(100).parse(req.params.id);
  res.json({
    rows: (
      await CashAudit.find({ ...scope(req), entityId }).sort({ createdAt: 1 })
    ).map(publicView),
  });
});
