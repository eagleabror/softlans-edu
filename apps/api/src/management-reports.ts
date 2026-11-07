import { Router } from "express";
import mongoose, {
  type ClientSession,
  type Model,
  type FilterQuery,
} from "mongoose";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type {
  ManagementMonth,
  ManagementReport,
  ExpenseAccountingClass,
} from "@softlans/contracts";
import {
  Charge,
  ChargeAdjustment,
  Payment,
  PaymentReversal,
} from "./billing-models.js";
import {
  Payroll,
  SalaryRule,
  SalaryPayout,
  SalaryPayoutReversal,
} from "./payroll-models.js";
import { CashAccount, CashMovement, Expense } from "./cash-models.js";
import { Group } from "./group-models.js";
import { principal, requireRoles, tenantScope } from "./security.js";
import { cashDay } from "./cash-service.js";
import { AppError } from "./errors.js";
import { csvCell } from "./debts.js";

export const managementInput = z
  .object({
    start: z.iso.date().refine((v) => v >= "2000-01-01"),
    end: z.iso.date(),
    asOf: z.iso.datetime({ offset: true }).optional(),
  })
  .strict()
  .refine(
    (q) =>
      q.start <= q.end &&
      q.end <= cashDay() &&
      Date.parse(q.end) - Date.parse(q.start) <= 365 * 86400000 &&
      (!q.asOf ||
        (Date.parse(q.asOf) <= Date.now() &&
          cashDay(new Date(q.asOf)) >= q.end)),
    {
      message:
        "Davrni tekshiring: eng ko‘pi 366 kun; kelajak sanasi mumkin emas.",
    },
  );
type Query = z.infer<typeof managementInput>;
// Every addition is exact, including signed corrections and balances.
export function reportSum(values: number[]) {
  let n = 0n;
  for (const v of values) {
    if (!Number.isSafeInteger(v))
      throw new AppError(422, "TOTAL_LIMIT", "Noto‘g‘ri pul summasi.");
    n += BigInt(v);
  }
  if (
    n > BigInt(Number.MAX_SAFE_INTEGER) ||
    n < -BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw new AppError(422, "TOTAL_LIMIT", "Hisobot summasi chegaradan oshdi.");
  return Number(n);
}
const add = (a: number, b: number) => reportSum([a, b]);
// Hard limits fail closed: a partial financial statement is never returned.
async function bounded<T>(
  model: Model<T>,
  filter: FilterQuery<T>,
  fields: string,
  tx: ClientSession,
) {
  const rows = await model
    .find(filter)
    .select(fields)
    .limit(20001)
    .maxTimeMS(15000)
    .session(tx)
    .lean();
  if (rows.length > 20000)
    throw new AppError(
      422,
      "REPORT_LIMIT",
      "Hisobot manbasi 20 000 yozuvdan oshdi. Arxivlash yoki alohida agregatsiya talab etiladi.",
    );
  return rows;
}
export async function managementReport(
  tenantId: mongoose.Types.ObjectId,
  q: Query,
): Promise<ManagementReport> {
  const asOf = q.asOf ? new Date(q.asOf) : new Date();
  const end = new Date(Date.parse(`${q.end}T00:00:00+05:00`) + 86400000);
  const cutoff = new Date(Math.min(+asOf, +end - 1));
  const effectiveEnd = cashDay(cutoff);
  const scope = { tenantId },
    recorded = { createdAt: { $lte: asOf } };
  return mongoose.connection.transaction(
    async (tx) => {
      // Sequential reads intentionally share one MongoDB snapshot transaction.
      const payments = await bounded(
        Payment,
        { ...scope, ...recorded, paidAt: { $lte: cutoff } },
        "chargeId studentId amount paidAt",
        tx,
      );
      const charges = await bounded(
        Charge,
        {
          ...scope,
          ...recorded,
          $or: [
            { billingMonth: { $lte: q.end.slice(0, 7) } },
            { _id: { $in: payments.map((p) => p.chargeId) } },
          ],
        },
        "groupId studentId billingMonth finalAmount cancelled updatedAt",
        tx,
      );
      const adjustments = await bounded(
        ChargeAdjustment,
        {
          ...scope,
          chargeId: { $in: charges.map((c) => c._id) },
          createdAt: { $gt: asOf },
        },
        "chargeId before createdAt",
        tx,
      );
      const paymentReversals = await bounded(
        PaymentReversal,
        {
          ...scope,
          paymentId: { $in: payments.map((p) => p._id) },
          createdAt: { $lte: cutoff },
        },
        "paymentId createdAt",
        tx,
      );
      const payrolls = await bounded(
        Payroll,
        {
          ...scope,
          ...recorded,
          payrollMonth: { $gte: q.start.slice(0, 7), $lte: q.end.slice(0, 7) },
        },
        "teacherId payrollMonth finalSalary approvedAt reversedAt status",
        tx,
      );
      const rules = await bounded(
        SalaryRule,
        { ...scope, ...recorded, effectiveFrom: { $lte: q.end } },
        "teacherId effectiveFrom effectiveUntil",
        tx,
      );
      const payouts = await bounded(
        SalaryPayout,
        { ...scope, ...recorded, paidAt: { $lte: cutoff } },
        "amount paidAt payrollId",
        tx,
      );
      const payoutReversals = await bounded(
        SalaryPayoutReversal,
        {
          ...scope,
          payoutId: { $in: payouts.map((p) => p._id) },
          createdAt: { $lte: cutoff },
        },
        "payoutId createdAt",
        tx,
      );
      const expenses = await bounded(
        Expense,
        { ...scope, ...recorded, expenseDate: { $lte: q.end } },
        "amount expenseDate categoryId accountingClassification categoryName status",
        tx,
      );
      const movements = await bounded(
        CashMovement,
        { ...scope, ...recorded, date: { $lte: effectiveEnd } },
        "accountId delta date kind sourceId",
        tx,
      );
      const accounts = await bounded(
        CashAccount,
        { ...scope, ...recorded },
        "name kind",
        tx,
      );
      const groups = await bounded(Group, scope, "name teacherId", tx);
      const warnings: ManagementReport["warnings"] = [];
      const warn = (
        code: string,
        message: string,
        month?: string,
        count?: number,
      ) =>
        warnings.push({
          code,
          message,
          ...(month ? { month } : {}),
          ...(count ? { count } : {}),
        });
      const months: ManagementMonth[] = [];
      for (let m = q.start.slice(0, 7); m <= q.end.slice(0, 7);) {
        months.push({
          month: m,
          billed: 0,
          receipts: 0,
          approvedSalary: 0,
          salaryPaid: 0,
          operatingExpenses: 0,
          estimatedResult: null,
        });
        const d = new Date(`${m}-01T00:00:00Z`);
        d.setUTCMonth(d.getUTCMonth() + 1);
        m = d.toISOString().slice(0, 7);
      }
      const monthMap = new Map(months.map((m) => [m.month, m]));
      const byGroup = new Map<string, ManagementReport["groups"][number]>();
      const groupTeachers = new Map(
        groups.map((g) => [String(g._id), g.teacherId]),
      );
      const groupNames = new Map(groups.map((g) => [String(g._id), g.name]));
      const groupRow = (id: string) => {
        if (!byGroup.has(id))
          byGroup.set(id, {
            id,
            name: groupNames.get(id) ?? "Nomi mavjud emas · tarixiy guruh",
            billed: 0,
            receipts: 0,
          });
        return byGroup.get(id)!;
      };
      const chargeMap = new Map(charges.map((c) => [String(c._id), c]));
      // Earliest later adjustment has the exact state at the requested recorded cutoff.
      adjustments.sort(
        (a, b) =>
          +a.createdAt! - +b.createdAt! ||
          String(a._id).localeCompare(String(b._id)),
      );
      const restored = new Set<string>();
      for (const a of adjustments) {
        const id = String(a.chargeId),
          c = chargeMap.get(id);
        if (!c || restored.has(id)) continue;
        const cancelled =
          typeof a.before?.cancelled === "boolean"
            ? a.before.cancelled
            : ["cancelled", "unpaid", "partial", "paid"].includes(
                  a.before?.status,
                )
              ? a.before.status === "cancelled"
              : undefined;
        if (
          !a.before ||
          !Number.isSafeInteger(a.before.finalAmount) ||
          typeof cancelled !== "boolean"
        ) {
          warn(
            "CHARGE_HISTORY",
            "Hisob tuzatish tarixi yetarli emas.",
            c.billingMonth,
          );
          continue;
        }
        c.finalAmount = a.before.finalAmount;
        c.cancelled = cancelled;
        restored.add(id);
      }
      const reversedPayments = new Set(
        paymentReversals.map((r) => String(r.paymentId)),
      );
      const paidByCharge = new Map<string, number>();
      const paymentMap = new Map(payments.map((p) => [String(p._id), p]));
      for (const p of payments) {
        const c = chargeMap.get(String(p.chargeId));
        if (!c || String(c.studentId) !== String(p.studentId))
          warn("PAYMENT_SOURCE", "Hisobga mos kelmaydigan to‘lov bor.");
        if (!reversedPayments.has(String(p._id)))
          paidByCharge.set(
            String(p.chargeId),
            add(paidByCharge.get(String(p.chargeId)) ?? 0, p.amount),
          );
        const day = cashDay(p.paidAt),
          m = monthMap.get(day.slice(0, 7));
        if (m && day >= q.start && day <= q.end) {
          m.receipts = add(m.receipts, p.amount);
          if (c && String(c.studentId) === String(p.studentId)) {
            const g = groupRow(String(c.groupId));
            g.receipts = add(g.receipts, p.amount);
          }
        }
      }
      for (const r of paymentReversals) {
        const p = paymentMap.get(String(r.paymentId))!,
          day = cashDay(r.createdAt!),
          m = monthMap.get(day.slice(0, 7));
        if (m && day >= q.start && day <= q.end) {
          m.receipts = add(m.receipts, -p.amount);
          const c = chargeMap.get(String(p.chargeId));
          if (c && String(c.studentId) === String(p.studentId)) {
            const g = groupRow(String(c.groupId));
            g.receipts = add(g.receipts, -p.amount);
          }
        }
      }
      let debt = 0;
      for (const c of charges) {
        if (c.cancelled || c.billingMonth > q.end.slice(0, 7)) continue;
        const paid = paidByCharge.get(String(c._id)) ?? 0;
        if (paid > c.finalAmount)
          warn(
            "OVERPAYMENT",
            "Hisob summasidan ortiq to‘lov bor.",
            c.billingMonth,
          );
        debt = add(debt, Math.max(0, reportSum([c.finalAmount, -paid])));
        const m = monthMap.get(c.billingMonth);
        if (m) {
          m.billed = add(m.billed, c.finalAmount);
          const g = groupRow(String(c.groupId));
          g.billed = add(g.billed, c.finalAmount);
        }
      }
      for (const m of months) {
        const ps = payrolls.filter((p) => p.payrollMonth === m.month);
        for (const p of ps) {
          if (
            p.status === "draft" ||
            !p.approvedAt ||
            p.approvedAt > asOf ||
            (p.reversedAt && p.reversedAt <= asOf)
          )
            warn(
              "PAYROLL_APPROVAL",
              "Maosh tasdig‘i yetishmaydi yoki bekor qilingan.",
              m.month,
            );
          else m.approvedSalary = add(m.approvedSalary, p.finalSalary);
        }
        const expected = new Set(
          rules
            .filter(
              (r) =>
                r.effectiveFrom <= m.month + "-01" &&
                (!r.effectiveUntil || r.effectiveUntil >= m.month + "-01"),
            )
            .map((r) => String(r.teacherId)),
        );
        for (const c of charges.filter(
          (c) => c.billingMonth === m.month && !c.cancelled,
        )) {
          const teacherId = groupTeachers.get(String(c.groupId));
          if (teacherId) expected.add(String(teacherId));
        }
        for (const teacher of expected)
          if (!ps.some((p) => String(p.teacherId) === teacher))
            warn(
              "PAYROLL_MISSING",
              "Maosh qoidasi bor, ammo oy uchun payroll yo‘q.",
              m.month,
            );
        if (!ps.length)
          warn(
            "PAYROLL_COVERAGE",
            "Oy uchun maosh manbalari to‘liqligi tasdiqlanmagan.",
            m.month,
          );
        if (!charges.some((c) => c.billingMonth === m.month && !c.cancelled))
          warn(
            "BILLING_COVERAGE",
            "Oy uchun hisoblar yo‘q; bu nol daromadni tasdiqlamaydi.",
            m.month,
          );
      }
      const payoutMap = new Map(payouts.map((p) => [String(p._id), p]));
      for (const p of payouts) {
        const day = cashDay(p.paidAt),
          m = monthMap.get(day.slice(0, 7));
        if (m && day >= q.start) m.salaryPaid = add(m.salaryPaid, p.amount);
      }
      for (const r of payoutReversals) {
        const day = cashDay(r.createdAt!),
          m = monthMap.get(day.slice(0, 7));
        if (m && day >= q.start)
          m.salaryPaid = add(
            m.salaryPaid,
            -payoutMap.get(String(r.payoutId))!.amount,
          );
      }
      const expenseMap = new Map(expenses.map((e) => [String(e._id), e]));
      const categoryTotals = new Map<
        string,
        ManagementReport["expenseCategories"][number]
      >();
      let unclassifiedExpenses = 0,
        unclassifiedMovements = 0;
      for (const e of expenses)
        if (e.status === "draft" && e.expenseDate >= q.start)
          warn(
            "EXPENSE_DRAFT",
            "Tasdiqlanmagan xarajat qoralamasi bor.",
            e.expenseDate.slice(0, 7),
          );
      const expenseSources = new Set(
        movements.filter((m) => m.kind === "expense").map((m) => m.sourceId),
      );
      const originalKinds = new Map(
        movements
          .filter((m) => m.kind !== "movement_void")
          .map((m) => [m.sourceId, m.kind]),
      );
      const allocatedPayments = new Set(
        movements.filter((m) => m.kind === "payment").map((m) => m.sourceId),
      );
      const allocatedSalary = new Set(
        movements.filter((m) => m.kind === "salary").map((m) => m.sourceId),
      );
      const openedAccounts = new Set(
        movements
          .filter((m) => m.kind === "opening")
          .map((m) => String(m.accountId)),
      );
      const cashRows = accounts.map((a) => ({
        id: String(a._id),
        name: a.name,
        kind: a.kind,
        opening: 0,
        openingEntries: 0,
        tuition: 0,
        salary: 0,
        expenses: 0,
        manual: 0,
        transfers: 0,
        closing: 0,
        initialized: openedAccounts.has(String(a._id)),
      }));
      const cashMap = new Map(cashRows.map((a) => [a.id, a]));
      for (const move of movements) {
        const account = cashMap.get(String(move.accountId));
        if (!account) {
          warn("CASH_ACCOUNT", "Pul harakatining hisobi topilmadi.");
          continue;
        }
        if (move.date < q.start)
          account.opening = add(account.opening, move.delta);
        else {
          const kind =
            move.kind === "movement_void"
              ? originalKinds.get(move.sourceId)
              : move.kind;
          const bucket =
            kind === "opening"
              ? "openingEntries"
              : kind === "payment" || kind === "payment_reversal"
                ? "tuition"
                : kind === "salary" || kind === "salary_reversal"
                  ? "salary"
                  : kind === "expense" || kind === "expense_void"
                    ? "expenses"
                    : kind === "transfer"
                      ? "transfers"
                      : "manual";
          account[bucket] = add(account[bucket], move.delta);
          if (bucket === "manual") {
            unclassifiedMovements++;
            warn(
              "MANUAL_UNCLASSIFIED",
              "Qo‘lda pul harakati daromad yoki xarajat sifatida tasniflanmagan.",
              move.date.slice(0, 7),
            );
          }
        }
        if (
          ["payment", "payment_reversal", "salary", "salary_reversal"].includes(
            move.kind,
          )
        ) {
          const payment = move.kind.startsWith("payment"),
            source = payment
              ? paymentMap.get(move.sourceId)
              : payoutMap.get(move.sourceId);
          const expected = source
            ? (move.kind.endsWith("reversal") ? -1 : 1) *
              (payment ? 1 : -1) *
              source.amount
            : null;
          if (
            expected === null ||
            expected !== move.delta ||
            (source &&
              !move.kind.endsWith("reversal") &&
              move.date !== cashDay(source.paidAt))
          )
            warn("CASH_SOURCE", "Kassa va to‘lov manbasi mos emas.");
        }
        if (move.kind === "expense" || move.kind === "expense_void") {
          const e = expenseMap.get(move.sourceId);
          if (
            !e ||
            e.status === "draft" ||
            move.delta !== (move.kind === "expense" ? -e.amount : e.amount)
          ) {
            warn("EXPENSE_SOURCE", "Xarajat va pul harakati mos emas.");
            continue;
          }
          // Original expense accrues to its expense date. Voids correct only the void month.
          const day = move.kind === "expense" ? e.expenseDate : move.date,
            m = monthMap.get(day.slice(0, 7));
          if (!m || day < q.start || day > q.end) continue;
          const classification = (e.accountingClassification ??
            "unclassified") as ExpenseAccountingClass;
          const amount = move.kind === "expense" ? e.amount : -e.amount;
          const key = String(e.categoryId) + ":" + classification;
          if (!categoryTotals.has(key))
            categoryTotals.set(key, {
              id: key,
              name: e.categoryName ?? "Tarixiy kategoriya · tekshirish kerak",
              classification,
              amount: 0,
            });
          const row = categoryTotals.get(key)!;
          row.amount = add(row.amount, amount);
          if (classification === "operating")
            m.operatingExpenses = add(m.operatingExpenses, amount);
          if (classification === "unclassified") {
            unclassifiedExpenses++;
            warn(
              "EXPENSE_UNCLASSIFIED",
              "Xarajatning hisob tasnifi yo‘q; natija hisoblanmaydi.",
              m.month,
            );
          }
        }
      }
      for (const e of expenses)
        if (e.status === "confirmed" && !expenseSources.has(String(e._id)))
          warn(
            "EXPENSE_RECONCILIATION",
            "Tasdiqlangan xarajat uchun kassa manbasi topilmadi.",
          );
      // A missing or non-zero transfer pair is a reconciliation failure, including reversals.
      const transfers = new Map<string, number[]>();
      for (const m of movements)
        if (
          m.kind === "transfer" ||
          (m.kind === "movement_void" &&
            originalKinds.get(m.sourceId) === "transfer")
        ) {
          const key = m.sourceId + m.kind;
          transfers.set(key, [...(transfers.get(key) ?? []), m.delta]);
        }
      for (const values of transfers.values())
        if (values.length !== 2 || reportSum(values) !== 0)
          warn(
            "TRANSFER_RECONCILIATION",
            "Hisoblararo o‘tkazma juftligi mos emas.",
          );
      for (const a of cashRows) {
        a.closing = reportSum([
          a.opening,
          a.openingEntries,
          a.tuition,
          a.salary,
          a.expenses,
          a.manual,
          a.transfers,
        ]);
        if (!a.initialized)
          warn(
            "OPENING_MISSING",
            "Hisobning boshlang‘ich qoldig‘i berilmagan.",
          );
      }
      const unallocated = {
        payments: { count: 0, amount: 0 },
        salaries: { count: 0, amount: 0 },
      };
      for (const p of payments)
        if (
          !allocatedPayments.has(String(p._id)) &&
          !reversedPayments.has(String(p._id))
        ) {
          unallocated.payments.count++;
          unallocated.payments.amount = add(
            unallocated.payments.amount,
            p.amount,
          );
        }
      const reversedCashPayments = new Set(
        movements
          .filter((m) => m.kind === "payment_reversal")
          .map((m) => m.sourceId),
      );
      const reversedCashSalaries = new Set(
        movements
          .filter((m) => m.kind === "salary_reversal")
          .map((m) => m.sourceId),
      );
      for (const r of paymentReversals)
        if (
          allocatedPayments.has(String(r.paymentId)) &&
          !reversedCashPayments.has(String(r.paymentId))
        )
          warn(
            "PAYMENT_RECONCILIATION",
            "To‘lov qaytarishi kassada aks etmagan.",
          );
      for (const r of payoutReversals)
        if (
          allocatedSalary.has(String(r.payoutId)) &&
          !reversedCashSalaries.has(String(r.payoutId))
        )
          warn(
            "SALARY_RECONCILIATION",
            "Maosh qaytarishi kassada aks etmagan.",
          );
      const reversedSalary = new Set(
        payoutReversals.map((r) => String(r.payoutId)),
      );
      for (const p of payouts)
        if (
          !allocatedSalary.has(String(p._id)) &&
          !reversedSalary.has(String(p._id))
        ) {
          unallocated.salaries.count++;
          unallocated.salaries.amount = add(
            unallocated.salaries.amount,
            p.amount,
          );
        }
      if (unallocated.payments.count || unallocated.salaries.count)
        warn(
          "UNALLOCATED_HISTORY",
          "Hisobsiz tarixiy to‘lovlar kassa qoldig‘iga qo‘shilmagan.",
        );
      for (const m of months) {
        const lastDay = new Date(
          Date.UTC(Number(m.month.slice(0, 4)), Number(m.month.slice(5, 7)), 0),
        )
          .toISOString()
          .slice(0, 10);
        if (q.start > m.month + "-01" || q.end < lastDay)
          warn(
            "PARTIAL_MONTH",
            "Ta’lim haqi va maosh to‘liq oyga tegishli; qisman oy uchun natija berilmaydi.",
            m.month,
          );
      }
      if (!cashRows.length)
        warn(
          "CASH_ACCOUNTS_MISSING",
          "Hisobot chegarasida kassa hisoblari yo‘q; pul qoldig‘i tasdiqlanmagan.",
        );
      const infoCodes = new Set([
        "UNALLOCATED_HISTORY",
        "OPENING_MISSING",
        "CASH_ACCOUNTS_MISSING",
      ]);
      for (const m of months)
        if (
          !warnings.some(
            (w) => !infoCodes.has(w.code) && (!w.month || w.month === m.month),
          )
        )
          m.estimatedResult = reportSum([
            m.billed,
            -m.approvedSalary,
            -m.operatingExpenses,
          ]);
      const total = (
        key: Exclude<keyof ManagementMonth, "month" | "estimatedResult">,
      ) => reportSum(months.map((m) => m[key]));
      const cashTotal = (
        key:
          | "opening"
          | "openingEntries"
          | "tuition"
          | "salary"
          | "expenses"
          | "manual"
          | "transfers"
          | "closing",
      ) => reportSum(cashRows.map((a) => a[key]));
      return {
        policy: "management-v1",
        period: {
          start: q.start,
          end: q.end,
          asOf: asOf.toISOString(),
          timezone: "Asia/Tashkent",
        },
        summary: {
          billed: total("billed"),
          receipts: total("receipts"),
          approvedSalary: total("approvedSalary"),
          salaryPaid: total("salaryPaid"),
          operatingExpenses: total("operatingExpenses"),
          debt,
          unclassifiedExpenses,
          unclassifiedMovements,
          estimatedResult: months.some((m) => m.estimatedResult === null)
            ? null
            : reportSum(months.map((m) => m.estimatedResult!)),
        },
        monthly: months,
        warnings: [
          ...new Map(
            warnings.map((w) => [w.code + (w.month ?? ""), w]),
          ).values(),
        ],
        expenseCategories: [...categoryTotals.values()],
        groups: [...byGroup.values()].sort(
          (a, b) => b.billed - a.billed || a.id.localeCompare(b.id),
        ),
        cash: {
          opening: cashTotal("opening"),
          openingEntries: cashTotal("openingEntries"),
          tuition: cashTotal("tuition"),
          salary: cashTotal("salary"),
          expenses: cashTotal("expenses"),
          manual: cashTotal("manual"),
          transfers: cashTotal("transfers"),
          closing: cashTotal("closing"),
          accounts: cashRows,
        },
        unallocated,
      };
    },
    { readConcern: { level: "snapshot" } },
  );
}
export function managementCsv(data: ManagementReport) {
  return (
    "\uFEFF" +
    [
      ["Boshqaruv taxmini · sertifikatlangan foyda emas", data.policy],
      [
        "Davr",
        data.period.start,
        data.period.end,
        "Asia/Tashkent",
        "Qayd chegarasi",
        data.period.asOf,
      ],
      [
        "Oy",
        "Hisoblangan ta’lim haqi",
        "Haqiqiy tushum (to‘lov sanasi)",
        "Tasdiqlangan maosh xarajati",
        "To‘langan maosh",
        "Operatsion xarajatlar",
        "Taxminiy moliyaviy natija",
      ],
      ...data.monthly.map((m) => [
        m.month,
        m.billed,
        m.receipts,
        m.approvedSalary,
        m.salaryPaid,
        m.operatingExpenses,
        m.estimatedResult ?? "Ma’lumot yetarli emas",
      ]),
      ["Qarzdorlik (barcha hisob oylari)", data.summary.debt],
      [
        "Hisob",
        "Davr boshidagi qoldiq",
        "Boshlang‘ich qoldiq yozuvlari",
        "Ta’lim tushumi",
        "Maosh pul oqimi",
        "Xarajat pul oqimi",
        "Tasniflanmagan qo‘lda",
        "O‘tkazmalar",
        "Davr oxiridagi qoldiq",
      ],
      ...data.cash.accounts.map((a) => [
        a.name,
        a.opening,
        a.openingEntries,
        a.tuition,
        a.salary,
        a.expenses,
        a.manual,
        a.transfers,
        a.closing,
      ]),
      [
        "Kassa jami",
        data.cash.opening,
        data.cash.openingEntries,
        data.cash.tuition,
        data.cash.salary,
        data.cash.expenses,
        data.cash.manual,
        data.cash.transfers,
        data.cash.closing,
      ],
      ["Kategoriya", "Hisob tasnifi", "Summa"],
      ...data.expenseCategories.map((c) => [
        c.name,
        c.classification,
        c.amount,
      ]),
      ["Guruh", "Hisoblangan", "To‘lov sanasiga tushum"],
      ...data.groups.map((g) => [g.name, g.billed, g.receipts]),
      [
        "Hisobsiz ta’lim to‘lovlari",
        data.unallocated.payments.count,
        data.unallocated.payments.amount,
      ],
      [
        "Hisobsiz maosh to‘lovlari",
        data.unallocated.salaries.count,
        data.unallocated.salaries.amount,
      ],
      ["Ogohlantirishlar"],
      ...data.warnings.map((w) => [
        w.code,
        w.month ?? "Barcha davrlar",
        w.message,
      ]),
    ]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n")
  );
}
export const managementRouter = Router();
managementRouter.use(requireRoles("business_owner"));
managementRouter.use(
  rateLimit({
    windowMs: 60000,
    limit: 20,
    message: {
      error: {
        code: "RATE_LIMITED",
        message: "Birozdan so‘ng qayta urinib ko‘ring.",
      },
    },
  }),
);
for (const path of ["/", "/export"])
  managementRouter.get(path, async (req, res) => {
    const q = managementInput.parse(req.query);
    const report = await managementReport(
      tenantScope(principal(req)).tenantId,
      q,
    );
    res.setHeader("Cache-Control", "no-store");
    if (path === "/export")
      res
        .attachment("boshqaruv-moliyaviy-hisobot.csv")
        .type("text/csv")
        .send(managementCsv(report));
    else res.json(report);
  });
