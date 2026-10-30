import type { ClientSession, Types } from "mongoose";
import { Charge, Payment, PaymentReversal } from "./billing-models.js";
import { Group } from "./group-models.js";
import { SalaryRule } from "./payroll-models.js";
import { monthBounds } from "./billing-validation.js";
import { AppError } from "./errors.js";
export function safeTotal(values: number[]) {
  const n = values.reduce((a, b) => a + BigInt(b), 0n);
  if (n < 0n || n > BigInt(Number.MAX_SAFE_INTEGER))
    throw new AppError(422, "TOTAL_LIMIT", "Hisobot summasi chegaradan oshdi.");
  return Number(n);
}
// Hundredths of a percent; half-up once per rule/group subtotal.
export function percentageSalary(amount: number, percentage: number) {
  return Number(
    (BigInt(amount) * BigInt(Math.round(percentage * 100)) + 5000n) / 10000n,
  );
}
export async function calculatePayroll(
  tenantId: Types.ObjectId,
  teacherId: string,
  month: string,
  tx: ClientSession,
) {
  const tenant = { tenantId },
    { start, end } = monthBounds(month),
    day = month + "-01";
  const rules = await SalaryRule.find({
    ...tenant,
    teacherId,
    archived: false,
    effectiveFrom: { $lte: day },
    $or: [{ effectiveUntil: null }, { effectiveUntil: { $gte: day } }],
  }).session(tx);
  const groups = await Group.find(tenant).session(tx);
  const payments = await Payment.find({
    ...tenant,
    paidAt: { $gte: start, $lt: end },
  })
    .limit(20001)
    .session(tx);
  const reversals = await PaymentReversal.find({
    ...tenant,
    paymentId: { $in: payments.map((p) => p._id) },
  }).session(tx);
  const reversed = new Set(reversals.map((r) => String(r.paymentId)));
  const charges = await Charge.find({
    ...tenant,
    cancelled: false,
    $or: [
      { billingMonth: month },
      { _id: { $in: payments.map((p) => p.chargeId) } },
    ],
  })
    .limit(20001)
    .session(tx);
  if (charges.length > 20000 || payments.length > 20000)
    throw new AppError(422, "REPORT_LIMIT", "Hisobot hajmi chegaradan oshdi.");
  const owned = charges.filter(
    (c) =>
      String(
        c.payrollTeacherId ??
          groups.find((g) => g._id.equals(c.groupId))?.teacherId,
      ) === teacherId,
  );
  const defaults = rules.find((r) => !r.groupId);
  const lines: {
    ruleId: string;
    groupId: string | null;
    salaryType: string;
    percentage: number | null;
    basisAmount: number;
    salary: number;
    sourceIds: string[];
    legacyAttribution: boolean;
  }[] = [];
  // Fixed default is paid once per teacher; group overrides replace default only for their own group.
  if (
    defaults?.salaryType === "fixed" &&
    (!groups.some((g) => String(g.teacherId) === teacherId) ||
      groups.some(
        (g) =>
          String(g.teacherId) === teacherId &&
          !rules.some((r) => r.groupId?.equals(g._id)),
      ))
  )
    lines.push({
      ruleId: defaults.id,
      groupId: null,
      salaryType: "fixed",
      percentage: null,
      basisAmount: defaults.fixedAmount!,
      salary: defaults.fixedAmount!,
      sourceIds: [],
      legacyAttribution: false,
    });
  const groupIds = new Set([
    ...owned.map((c) => String(c.groupId)),
    ...rules
      .filter(
        (r) =>
          r.groupId &&
          groups.some(
            (g) =>
              g._id.equals(r.groupId!) && String(g.teacherId) === teacherId,
          ),
      )
      .map((r) => String(r.groupId)),
  ]);
  for (const groupId of [...groupIds].sort()) {
    const rule = rules.find((r) => String(r.groupId) === groupId) ?? defaults;
    if (!rule || (rule === defaults && rule.salaryType === "fixed")) continue;
    const cs = owned.filter((c) => String(c.groupId) === groupId);
    const ps = payments.filter(
      (p) =>
        !reversed.has(String(p._id)) &&
        cs.some((c) => c._id.equals(p.chargeId)),
    );
    const sources =
      rule.salaryType === "collected"
        ? ps
        : cs.filter((c) => c.billingMonth === month);
    const basis =
      rule.salaryType === "fixed"
        ? rule.fixedAmount!
        : safeTotal(
            sources.map((s) => ("amount" in s ? s.amount : s.finalAmount)),
          );
    lines.push({
      ruleId: rule.id,
      groupId,
      salaryType: rule.salaryType,
      percentage: rule.percentage ?? null,
      basisAmount: basis,
      salary:
        rule.salaryType === "fixed"
          ? basis
          : percentageSalary(basis, rule.percentage!),
      sourceIds: sources.map((s) => s.id),
      legacyAttribution: cs.some((c) => !c.payrollTeacherId),
    });
  }
  if (!rules.length)
    throw new AppError(
      409,
      "NO_SALARY_RULE",
      "Oy boshida amal qiluvchi maosh qoidasini kiriting.",
    );
  return {
    policyVersion: "tashkent-charge-owner-v1",
    timezone: "Asia/Tashkent",
    month,
    lines,
    grossSalary: safeTotal(lines.map((l) => l.salary)),
  };
}
