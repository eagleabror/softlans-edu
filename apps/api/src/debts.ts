import { Router } from "express";
import mongoose, { type PipelineStage } from "mongoose";
import type { z } from "zod";
import type { DebtSummary } from "@softlans/contracts";
import { Charge, Payment, PaymentReversal } from "./billing-models.js";
import { Student } from "./models.js";
import { Group } from "./group-models.js";
import { principal, requireRoles, tenantScope } from "./security.js";
import { AppError } from "./errors.js";
import { debtInput } from "./debt-validation.js";

type Query = z.infer<typeof debtInput>;
type Scope = { tenantId: mongoose.Types.ObjectId };
export const DEBT_TIMEZONE = "Asia/Tashkent";
export function localDay(now: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DEBT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function daysOverdue(dueDate: Date, now = new Date()) {
  return Math.max(
    0,
    Math.round(
      (Date.parse(localDay(now)) - Date.parse(localDay(dueDate))) / 86400000,
    ),
  );
}
export function agingBucket(days: number) {
  return days === 0
    ? "upcoming"
    : days <= 7
      ? "1-7"
      : days <= 30
        ? "8-30"
        : "31+";
}
const regex = (value: string) =>
  new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
// One row per charge: memberships never participate, so duplicate memberships cannot multiply debt.
// All joins include tenant identity; never rely on a referenced ObjectId alone.
export function debtPipeline(
  scope: Scope,
  q: Query,
  now: Date,
): PipelineStage[] {
  return [
    {
      $match: {
        ...scope,
        cancelled: false,
        ...(q.month ? { billingMonth: q.month } : {}),
        ...(q.groupId
          ? { groupId: new mongoose.Types.ObjectId(q.groupId) }
          : {}),
        ...(q.studentId
          ? { studentId: new mongoose.Types.ObjectId(q.studentId) }
          : {}),
      },
    },
    {
      $lookup: {
        from: Payment.collection.name,
        let: { charge: "$_id", student: "$studentId" },
        pipeline: [
          {
            $match: {
              ...scope,
              $expr: {
                $and: [
                  { $eq: ["$chargeId", "$$charge"] },
                  { $eq: ["$studentId", "$$student"] },
                ],
              },
            },
          },
          {
            $lookup: {
              from: PaymentReversal.collection.name,
              let: { payment: "$_id" },
              pipeline: [
                {
                  $match: {
                    ...scope,
                    $expr: { $eq: ["$paymentId", "$$payment"] },
                  },
                },
                { $limit: 1 },
              ],
              as: "reversals",
            },
          },
          { $match: { "reversals.0": { $exists: false } } },
          { $group: { _id: null, amount: { $sum: "$amount" } } },
        ],
        as: "ledger",
      },
    },
    {
      $set: {
        paidAmount: {
          $max: [0, { $ifNull: [{ $arrayElemAt: ["$ledger.amount", 0] }, 0] }],
        },
      },
    },
    {
      $set: {
        remainingAmount: {
          $max: [0, { $subtract: ["$finalAmount", "$paidAmount"] }],
        },
        daysOverdue: {
          $max: [
            0,
            {
              $dateDiff: {
                startDate: "$dueDate",
                endDate: now,
                unit: "day",
                timezone: DEBT_TIMEZONE,
              },
            },
          ],
        },
      },
    },
    {
      $match: {
        remainingAmount: {
          $gt: 0,
          ...(q.minAmount !== undefined ? { $gte: q.minAmount } : {}),
          ...(q.maxAmount !== undefined ? { $lte: q.maxAmount } : {}),
        },
        ...(q.status
          ? {
              daysOverdue:
                q.status === "upcoming"
                  ? 0
                  : q.status === "1-7"
                    ? { $gte: 1, $lte: 7 }
                    : q.status === "8-30"
                      ? { $gte: 8, $lte: 30 }
                      : q.status === "31+"
                        ? { $gt: 30 }
                        : { $gt: 0 },
            }
          : {}),
      },
    },
    {
      $lookup: {
        from: Student.collection.name,
        let: { student: "$studentId" },
        pipeline: [
          {
            $match: {
              ...scope,
              $expr: { $eq: ["$_id", "$$student"] },
              ...(q.search
                ? {
                    $and: q.search
                      .split(/\s+/)
                      .map((token) => ({
                        $or: [
                          { firstName: regex(token) },
                          { lastName: regex(token) },
                        ],
                      })),
                  }
                : {}),
            },
          },
          { $project: { firstName: 1, lastName: 1 } },
        ],
        as: "student",
      },
    },
    ...(q.search ? [{ $match: { "student.0": { $exists: true } } }] : []),
    { $unset: "ledger" },
  ];
}
const rowProjection: PipelineStage.FacetPipelineStage[] = [
  {
    $lookup: {
      from: Group.collection.name,
      let: { group: "$groupId", tenant: "$tenantId" },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ["$_id", "$$group"] },
                { $eq: ["$tenantId", "$$tenant"] },
              ],
            },
          },
        },
        { $project: { name: 1 } },
      ],
      as: "group",
    },
  },
  {
    $project: {
      _id: 0,
      id: { $toString: "$_id" },
      studentId: { $toString: "$studentId" },
      groupId: { $toString: "$groupId" },
      studentName: {
        $ifNull: [
          {
            $concat: [
              { $arrayElemAt: ["$student.firstName", 0] },
              " ",
              { $arrayElemAt: ["$student.lastName", 0] },
            ],
          },
          "—",
        ],
      },
      groupName: { $ifNull: [{ $arrayElemAt: ["$group.name", 0] }, "—"] },
      billingMonth: 1,
      originalAmount: 1,
      discountAmount: 1,
      finalAmount: 1,
      paidAmount: 1,
      remainingAmount: 1,
      dueDate: 1,
      daysOverdue: 1,
      status: { $cond: [{ $gt: ["$paidAmount", 0] }, "partial", "unpaid"] },
      agingBucket: {
        $switch: {
          branches: [
            { case: { $eq: ["$daysOverdue", 0] }, then: "upcoming" },
            { case: { $lte: ["$daysOverdue", 7] }, then: "1-7" },
            { case: { $lte: ["$daysOverdue", 30] }, then: "8-30" },
          ],
          default: "31+",
        },
      },
    },
  },
];
const overdue = { $gt: ["$daysOverdue", 0] };
const totalFields = {
  outstandingAmount: { $sum: "$remainingAmount" },
  overdueAmount: { $sum: { $cond: [overdue, "$remainingAmount", 0] } },
  upcomingAmount: {
    $sum: { $cond: [{ $eq: ["$daysOverdue", 0] }, "$remainingAmount", 0] },
  },
  overdue1To7: {
    $sum: {
      $cond: [
        { $and: [overdue, { $lte: ["$daysOverdue", 7] }] },
        "$remainingAmount",
        0,
      ],
    },
  },
  overdue8To30: {
    $sum: {
      $cond: [
        {
          $and: [{ $gt: ["$daysOverdue", 7] }, { $lte: ["$daysOverdue", 30] }],
        },
        "$remainingAmount",
        0,
      ],
    },
  },
  overdueMoreThan30: {
    $sum: { $cond: [{ $gt: ["$daysOverdue", 30] }, "$remainingAmount", 0] },
  },
};
async function aggregate<T>(pipeline: PipelineStage[]) {
  // Snapshot reads prevent concurrent reversals/adjustments producing a mixed ledger view.
  return mongoose.connection.transaction(
    (session) =>
      Charge.aggregate<T>(pipeline)
        .session(session)
        .option({ maxTimeMS: 15000, allowDiskUse: true })
        .exec(),
    { readConcern: { level: "snapshot" } },
  );
}
export async function debtSummary(
  scope: Scope,
  q = debtInput.parse({}),
  now = new Date(),
): Promise<DebtSummary> {
  const [result] = await aggregate<{
    totals: Record<string, number>[];
    students: { count: number; overdue: number }[];
  }>([
    ...debtPipeline(scope, q, now),
    {
      $facet: {
        totals: [
          { $group: { _id: null, ...totalFields } },
          { $project: { _id: 0 } },
        ],
        students: [
          {
            $group: {
              _id: "$studentId",
              overdue: { $max: { $cond: [overdue, 1, 0] } },
            },
          },
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              overdue: { $sum: "$overdue" },
            },
          },
        ],
      },
    },
  ]);
  const totals =
    result?.totals[0] ??
    Object.fromEntries(Object.keys(totalFields).map((k) => [k, 0]));
  if (!Object.values(totals).every(Number.isSafeInteger))
    throw new AppError(422, "TOTAL_LIMIT", "Hisobot summasi chegaradan oshdi.");
  return {
    ...totals,
    debtorCount: result?.students[0]?.count ?? 0,
    overdueDebtorCount: result?.students[0]?.overdue ?? 0,
    asOf: now.toISOString(),
    timezone: DEBT_TIMEZONE,
  } as DebtSummary;
}
export function csvCell(value: unknown) {
  let text = String(value ?? "");
  if (/^[\s\u0000-\u001f]*[=+\-@]/u.test(text) || /^[\t\r\n]/.test(text))
    text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
export const debtsRouter = Router();
debtsRouter.use(requireRoles("business_owner", "admin"));
debtsRouter.get("/summary", async (req, res) =>
  res.json(
    await debtSummary(tenantScope(principal(req)), debtInput.parse(req.query)),
  ),
);
debtsRouter.get("/groups", async (req, res) => {
  const q = debtInput.parse(req.query),
    scope = tenantScope(principal(req));
  const [result] = (await aggregate([
    ...debtPipeline(scope, q, new Date()),
    {
      $group: {
        _id: { group: "$groupId", student: "$studentId" },
        dueDate: { $min: "$dueDate" },
        ...totalFields,
      },
    },
    {
      $group: {
        _id: "$_id.group",
        dueDate: { $min: "$dueDate" },
        debtorCount: { $sum: 1 },
        overdueDebtorCount: {
          $sum: { $cond: [{ $gt: ["$overdueAmount", 0] }, 1, 0] },
        },
        ...Object.fromEntries(
          Object.keys(totalFields).map((k) => [k, { $sum: `$${k}` }]),
        ),
      },
    },
    { $set: { groupId: "$_id", tenantId: scope.tenantId } },
    {
      $facet: {
        total: [{ $count: "count" }],
        groups: [
          {
            $sort: {
              [q.sort === "dueDate" ? "dueDate" : "outstandingAmount"]:
                q.order === "asc" ? 1 : -1,
              _id: 1,
            },
          },
          { $skip: (q.page - 1) * q.pageSize },
          { $limit: q.pageSize },
          ...rowProjection.slice(0, 1),
          {
            $project: {
              _id: 0,
              groupId: { $toString: "$groupId" },
              groupName: {
                $ifNull: [{ $arrayElemAt: ["$group.name", 0] }, "—"],
              },
              debtorCount: 1,
              overdueDebtorCount: 1,
              ...Object.fromEntries(
                Object.keys(totalFields).map((k) => [k, 1]),
              ),
            },
          },
        ],
      },
    },
  ])) as { groups: Record<string, unknown>[]; total: { count: number }[] }[];
  for (const group of result?.groups ?? []) {
    if (!Object.keys(totalFields).every((k) => Number.isSafeInteger(group[k])))
      throw new AppError(
        422,
        "TOTAL_LIMIT",
        "Hisobot summasi chegaradan oshdi.",
      );
  }
  res.json({
    groups: result?.groups ?? [],
    total: result?.total[0]?.count ?? 0,
    page: q.page,
    pageSize: q.pageSize,
  });
});
async function list(
  scope: Scope,
  q: Query,
  now = new Date(),
  exportRows = false,
) {
  const [result] = await aggregate<{
    charges: Record<string, unknown>[];
    total: { count: number }[];
  }>([
    ...debtPipeline(scope, q, now),
    {
      $facet: {
        total: [{ $count: "count" }],
        charges: [
          { $sort: { [q.sort]: q.order === "asc" ? 1 : -1, _id: 1 } },
          { $skip: exportRows ? 0 : (q.page - 1) * q.pageSize },
          { $limit: exportRows ? 5001 : q.pageSize },
          ...rowProjection,
        ],
      },
    },
  ]);
  return {
    charges: result?.charges ?? [],
    total: result?.total[0]?.count ?? 0,
    page: q.page,
    pageSize: q.pageSize,
    asOf: now.toISOString(),
    timezone: DEBT_TIMEZONE,
  };
}
debtsRouter.get("/export", async (req, res) => {
  const q = debtInput.parse(req.query),
    result = await list(tenantScope(principal(req)), q, new Date(), true);
  if (result.total > 5000)
    throw new AppError(
      422,
      "EXPORT_LIMIT",
      "Eksport 5000 hisob bilan cheklangan. Filtrlarni aniqlashtiring.",
    );
  const keys = [
    "studentName",
    "groupName",
    "billingMonth",
    "originalAmount",
    "finalAmount",
    "paidAmount",
    "remainingAmount",
    "dueDate",
    "daysOverdue",
    "status",
  ];
  const header = [
    "O‘quvchi",
    "Guruh",
    "Hisob oyi",
    "Asl summa",
    "Yakuniy summa",
    "To‘langan",
    "Qolgan qarz",
    "Muddat (Asia/Tashkent)",
    "Kechikkan kunlar",
    "Holat",
  ];
  const csv = [
    header.map(csvCell).join(","),
    ...result.charges.map((c) =>
      keys
        .map((k) =>
          csvCell(
            k === "dueDate"
              ? localDay(new Date(c[k] as string))
              : k === "status"
                ? c[k] === "partial"
                  ? "Qisman"
                  : "To‘lanmagan"
                : c[k],
          ),
        )
        .join(","),
    ),
  ].join("\r\n");
  res.setHeader("Content-Disposition", 'attachment; filename="qarzdorlar.csv"');
  res.type("text/csv; charset=utf-8").send(`\uFEFF${csv}`);
});
debtsRouter.get("/students/:id", async (req, res) => {
  const scope = tenantScope(principal(req));
  if (
    !mongoose.isObjectIdOrHexString(req.params.id) ||
    !(await Student.exists({ ...scope, _id: req.params.id }))
  )
    throw new AppError(404, "NOT_FOUND", "O‘quvchi topilmadi.");
  const q = debtInput.parse(req.query);
  q.studentId = String(req.params.id);
  const now = new Date();
  res.json({
    ...(await list(scope, q, now)),
    summary: await debtSummary(scope, q, now),
  });
});
debtsRouter.get("/overdue", async (req, res) => {
  const q = debtInput.parse(req.query);
  if (q.status === "upcoming")
    throw new AppError(
      400,
      "INVALID_FILTER",
      "Muddati o‘tgan holatni tanlang.",
    );
  q.status ??= "overdue";
  res.json(await list(tenantScope(principal(req)), q));
});
debtsRouter.get("/", async (req, res) =>
  res.json(await list(tenantScope(principal(req)), debtInput.parse(req.query))),
);
