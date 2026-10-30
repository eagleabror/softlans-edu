import { Router } from "express";
import mongoose, { type PipelineStage } from "mongoose";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { Charge, Payment, PaymentReversal } from "./billing-models.js";
import { Group, Membership } from "./group-models.js";
import { principal, requireRoles, tenantScope } from "./security.js";
import { csvCell, localDay } from "./debts.js";
import { AppError } from "./errors.js";
import type { FinancialReport, FinancialGroup } from "@softlans/contracts";

const day = z
  .string()
  .regex(/^20\d{2}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !isNaN(+d) && d.toISOString().slice(0, 10) === v;
  });
export const analyticsInput = z
  .object({
    start: day,
    end: day,
    groupId: z
      .string()
      .regex(/^[a-f\d]{24}$/i)
      .optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    sort: z
      .enum(["name", "billed", "collected", "outstanding", "rate", "students"])
      .default("billed"),
    order: z.enum(["asc", "desc"]).default("desc"),
    report: z
      .enum(["monthly", "groups", "methods", "aging"])
      .default("monthly"),
  })
  .strict()
  .refine(
    (q) =>
      q.start <= q.end &&
      (Date.parse(q.end) - Date.parse(q.start)) / 86400000 <= 365 &&
      q.end <= localDay(new Date()),
    { message: "Davr 366 kundan oshmasligi va kelajakda bo‘lmasligi kerak." },
  );
type Query = z.infer<typeof analyticsInput>;
type Scope = { tenantId: mongoose.Types.ObjectId };
export function period(q: Query) {
  return {
    start: new Date(`${q.start}T00:00:00+05:00`),
    end: new Date(Date.parse(`${q.end}T00:00:00+05:00`) + 86400000),
    firstMonth: q.start.slice(0, 7),
    lastMonth: q.end.slice(0, 7),
  };
}
// Integer basis points, half-up rounding. Cap each charge before summing.
export function collectionRate(collected: number, billed: number) {
  if (!billed) return 0;
  return (
    Number(
      (BigInt(Math.min(collected, billed)) * 10000n + BigInt(billed) / 2n) /
        BigInt(billed),
    ) / 100
  );
}
const sum = (field: string) => ({ $sum: `$${field}` });
type ReadStage = Exclude<
  PipelineStage,
  PipelineStage.Merge | PipelineStage.Out
>;
function validPayments(scope: Scope): ReadStage[] {
  return [
    {
      $lookup: {
        from: PaymentReversal.collection.name,
        let: { id: "$_id" },
        pipeline: [
          { $match: { ...scope, $expr: { $eq: ["$paymentId", "$$id"] } } },
          { $limit: 1 },
        ],
        as: "reversals",
      },
    },
    { $match: { "reversals.0": { $exists: false } } },
  ];
}
export function ledger(scope: Scope, end: Date): ReadStage[] {
  return [
    {
      $lookup: {
        from: Payment.collection.name,
        let: { charge: "$_id", student: "$studentId" },
        pipeline: [
          {
            $match: {
              ...scope,
              paidAt: { $lt: end },
              $expr: {
                $and: [
                  { $eq: ["$chargeId", "$$charge"] },
                  { $eq: ["$studentId", "$$student"] },
                ],
              },
            },
          },
          ...validPayments(scope),
          { $group: { _id: null, amount: sum("amount") } },
        ],
        as: "ledger",
      },
    },
    {
      $set: {
        collected: {
          $min: [
            "$finalAmount",
            { $ifNull: [{ $arrayElemAt: ["$ledger.amount", 0] }, 0] },
          ],
        },
      },
    },
    {
      $set: {
        billed: "$finalAmount",
        outstanding: {
          $max: [0, { $subtract: ["$finalAmount", "$collected"] }],
        },
        days: {
          $max: [
            0,
            {
              $dateDiff: {
                startDate: "$dueDate",
                endDate: new Date(+end - 1),
                unit: "day",
                timezone: "Asia/Tashkent",
              },
            },
          ],
        },
      },
    },
  ];
}
const moneyFields = {
  billed: sum("billed"),
  collected: sum("collected"),
  outstanding: sum("outstanding"),
};
function assertSafe(value: unknown): void {
  if (
    typeof value === "number" &&
    (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)
  )
    throw new AppError(422, "TOTAL_LIMIT", "Hisobot summasi chegaradan oshdi.");
  if (value && typeof value === "object")
    Object.values(value).forEach(assertSafe);
}
export async function financialReport(
  scope: Scope,
  q: Query,
): Promise<FinancialReport> {
  const p = period(q),
    group = q.groupId
      ? { groupId: new mongoose.Types.ObjectId(q.groupId) }
      : {};
  return mongoose.connection.transaction(
    async (session) => {
      const run = <T>(model: typeof Charge, pipeline: PipelineStage[]) =>
        model
          .aggregate<T>(pipeline)
          .session(session)
          .option({ maxTimeMS: 15000, allowDiskUse: false })
          .exec();
      const [charges] = await run<{
        cohorts: {
          _id: string;
          billed: number;
          collected: number;
          outstanding: number;
        }[];
        debt: { _id: string; amount: number }[];
        debtors: { count: number }[];
      }>(Charge, [
        {
          $match: {
            ...scope,
            ...group,
            cancelled: false,
            billingMonth: { $lte: p.lastMonth },
          },
        },
        ...ledger(scope, p.end),
        {
          $facet: {
            cohorts: [
              { $match: { billingMonth: { $gte: p.firstMonth } } },
              { $group: { _id: "$billingMonth", ...moneyFields } },
              { $sort: { _id: 1 } },
            ],
            debt: [
              { $match: { outstanding: { $gt: 0 } } },
              {
                $group: {
                  _id: {
                    $switch: {
                      branches: [
                        { case: { $eq: ["$days", 0] }, then: "upcoming" },
                        { case: { $lte: ["$days", 7] }, then: "1-7" },
                        { case: { $lte: ["$days", 30] }, then: "8-30" },
                      ],
                      default: "31+",
                    },
                  },
                  amount: sum("outstanding"),
                },
              },
            ],
            debtors: [
              { $match: { outstanding: { $gt: 0 } } },
              { $group: { _id: "$studentId" } },
              { $count: "count" },
            ],
          },
        },
      ]);
      // Transaction-date totals are independent of the charge's billing month.
      const [payments] = await Payment.aggregate<{
        monthly: { _id: string; amount: number; count: number }[];
        methods: { _id: string; amount: number; count: number }[];
      }>([
        { $match: { ...scope, paidAt: { $gte: p.start, $lt: p.end } } },
        ...validPayments(scope),
        {
          $lookup: {
            from: Charge.collection.name,
            let: { id: "$chargeId", student: "$studentId" },
            pipeline: [
              {
                $match: {
                  ...scope,
                  ...group,
                  cancelled: false,
                  $expr: {
                    $and: [
                      { $eq: ["$_id", "$$id"] },
                      { $eq: ["$studentId", "$$student"] },
                    ],
                  },
                },
              },
              { $project: { _id: 1 } },
            ],
            as: "charge",
          },
        },
        { $match: { "charge.0": { $exists: true } } },
        {
          $facet: {
            monthly: [
              {
                $group: {
                  _id: {
                    $dateToString: {
                      date: "$paidAt",
                      format: "%Y-%m",
                      timezone: "Asia/Tashkent",
                    },
                  },
                  amount: sum("amount"),
                  count: { $sum: 1 },
                },
              },
            ],
            methods: [
              {
                $group: {
                  _id: "$method",
                  amount: sum("amount"),
                  count: { $sum: 1 },
                },
              },
            ],
          },
        },
      ])
        .session(session)
        .option({ maxTimeMS: 15000, allowDiskUse: false });
      const groupRows = await Group.aggregate<FinancialGroup>([
        {
          $match: {
            ...scope,
            ...(q.groupId
              ? { _id: new mongoose.Types.ObjectId(q.groupId) }
              : {}),
          },
        },
        { $limit: 5001 },
        {
          $lookup: {
            from: Charge.collection.name,
            let: { id: "$_id" },
            pipeline: [
              {
                $match: {
                  ...scope,
                  cancelled: false,
                  billingMonth: { $gte: p.firstMonth, $lte: p.lastMonth },
                  $expr: { $eq: ["$groupId", "$$id"] },
                },
              },
              ...ledger(scope, p.end),
              { $group: { _id: null, ...moneyFields } },
            ],
            as: "totals",
          },
        },
        {
          $lookup: {
            from: Membership.collection.name,
            let: { id: "$_id" },
            pipeline: [
              {
                $match: {
                  ...scope,
                  status: "active",
                  $expr: { $eq: ["$groupId", "$$id"] },
                },
              },
              { $group: { _id: "$studentId" } },
              { $count: "count" },
            ],
            as: "members",
          },
        },
        {
          $project: {
            _id: 0,
            id: { $toString: "$_id" },
            name: 1,
            students: { $ifNull: [{ $arrayElemAt: ["$members.count", 0] }, 0] },
            ...Object.fromEntries(
              ["billed", "collected", "outstanding"].map((k) => [
                k,
                { $ifNull: [{ $arrayElemAt: [`$totals.${k}`, 0] }, 0] },
              ]),
            ),
          },
        },
      ])
        .session(session)
        .option({ maxTimeMS: 15000, allowDiskUse: false });
      if (groupRows.length > 5000)
        throw new AppError(
          422,
          "REPORT_LIMIT",
          "Guruh filtrini tanlang. Hisobot chegarasi: 5000 guruh.",
        );
      const monthly: FinancialReport["monthly"] = [];
      let month = p.firstMonth;
      while (month <= p.lastMonth) {
        const c = charges?.cohorts.find((r) => r._id === month),
          t = payments?.monthly.find((r) => r._id === month);
        monthly.push({
          month,
          billed: c?.billed ?? 0,
          collected: c?.collected ?? 0,
          payments: t?.amount ?? 0,
          count: t?.count ?? 0,
        });
        const d = new Date(`${month}-01T00:00:00Z`);
        d.setUTCMonth(d.getUTCMonth() + 1);
        month = d.toISOString().slice(0, 7);
      }
      const aging = ["upcoming", "1-7", "8-30", "31+"].map((bucket) => ({
        bucket,
        amount: charges?.debt.find((r) => r._id === bucket)?.amount ?? 0,
      }));
      const methods = ["cash", "bank_transfer", "click_manual"].map(
        (method) => ({
          method,
          amount: payments?.methods.find((r) => r._id === method)?.amount ?? 0,
          count: payments?.methods.find((r) => r._id === method)?.count ?? 0,
        }),
      );
      const total = (key: "billed" | "collected" | "payments" | "count") =>
        monthly.reduce((s, r) => s + r[key], 0);
      const billed = total("billed"),
        collected = total("collected");
      assertSafe({ monthly, groupRows, aging, methods, billed, collected });
      const groups = groupRows.map((g) => ({
        ...g,
        rate: collectionRate(g.collected, g.billed),
      }));
      groups.sort((a, b) => {
        const av = a[q.sort],
          bv = b[q.sort];
        const n =
          typeof av === "string"
            ? av.localeCompare(String(bv))
            : Number(av) - Number(bv);
        return (q.order === "asc" ? n : -n) || a.id.localeCompare(b.id);
      });
      const result = {
        period: {
          start: q.start,
          end: q.end,
          firstMonth: p.firstMonth,
          lastMonth: p.lastMonth,
          timezone: "Asia/Tashkent",
          asOf: new Date(+p.end - 1).toISOString(),
        },
        summary: {
          payments: total("payments"),
          paymentCount: total("count"),
          billed,
          collected,
          outstanding: billed - collected,
          overdue: aging.slice(1).reduce((s, r) => s + r.amount, 0),
          debtors: charges?.debtors[0]?.count ?? 0,
          rate: collectionRate(collected, billed),
        },
        monthly,
        aging,
        methods,
        groups,
        totalGroups: groups.length,
      };
      assertSafe(result);
      return result;
    },
    { readConcern: { level: "snapshot" } },
  );
}
export const analyticsRouter = Router();
analyticsRouter.use(requireRoles("business_owner", "admin"));
analyticsRouter.use(
  rateLimit({
    windowMs: 60000,
    limit: 30,
    message: {
      error: {
        code: "RATE_LIMITED",
        message: "Birozdan so‘ng qayta urinib ko‘ring.",
      },
    },
  }),
);
const agingNames: Record<string, string> = {
  upcoming: "Muddati kelmagan",
  "1-7": "1–7 kun",
  "8-30": "8–30 kun",
  "31+": "30 kundan ortiq",
};
const methodNames: Record<string, string> = {
  cash: "Naqd",
  bank_transfer: "Bank o‘tkazmasi",
  click_manual: "Click (qo‘lda)",
};
export function reportCsv(data: FinancialReport, kind: Query["report"]) {
  const headers =
    kind === "monthly"
      ? [
          "Oy",
          "Hisoblangan (UZS)",
          "Hisob oyiga yig‘ilgan (UZS)",
          "To‘lov sanasi bo‘yicha (UZS)",
          "To‘lovlar soni",
        ]
      : kind === "groups"
        ? [
            "Guruh",
            "Faol o‘quvchilar",
            "Hisoblangan (UZS)",
            "Yig‘ilgan (UZS)",
            "Qoldiq (UZS)",
            "Yig‘im (%)",
          ]
        : kind === "methods"
          ? ["To‘lov usuli", "Summa (UZS)", "To‘lovlar soni"]
          : ["Qarz muddati", "Summa (UZS)"];
  const rows =
    kind === "monthly"
      ? data.monthly.map((r) => [
          r.month,
          r.billed,
          r.collected,
          r.payments,
          r.count,
        ])
      : kind === "groups"
        ? data.groups.map((r) => [
            r.name,
            r.students,
            r.billed,
            r.collected,
            r.outstanding,
            r.rate,
          ])
        : kind === "methods"
          ? data.methods.map((r) => [methodNames[r.method], r.amount, r.count])
          : data.aging.map((r) => [agingNames[r.bucket], r.amount]);
  return (
    "\uFEFF" +
    [
      ["Davr", data.period.start, data.period.end, "Asia/Tashkent"],
      ["Hisob oylari", data.period.firstMonth, data.period.lastMonth],
      ["Qarz holati", data.period.end, "Barcha oldingi hisob oylari"],
      headers,
      ...rows,
    ]
      .map((r) => r.map(csvCell).join(","))
      .join("\r\n")
  );
}
for (const path of [
  "dashboard",
  "summary",
  "monthly-payments",
  "billing-collection",
  "debt-aging",
  "payment-methods",
  "groups",
  "export",
]) {
  analyticsRouter.get(`/${path}`, async (req, res) => {
    const q = analyticsInput.parse(req.query),
      data = await financialReport(tenantScope(principal(req)), q);
    if (path === "export") {
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="moliyaviy-${q.report}.csv"`,
      );
      res.type("text/csv").send(reportCsv(data, q.report));
      return;
    }
    const groups = {
      groups: data.groups.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
      total: data.totalGroups,
      page: q.page,
      pageSize: q.pageSize,
    };
    res.json(
      path === "dashboard"
        ? { ...data, groups: groups.groups, page: q.page, pageSize: q.pageSize }
        : path === "summary"
          ? data.summary
          : path === "monthly-payments" || path === "billing-collection"
            ? data.monthly
            : path === "debt-aging"
              ? data.aging
              : path === "payment-methods"
                ? data.methods
                : groups,
    );
  });
}
