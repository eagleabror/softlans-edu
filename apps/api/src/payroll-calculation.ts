import type { ClientSession, Types } from "mongoose";
import { Charge, Payment, PaymentReversal } from "./billing-models.js";
import { Group } from "./group-models.js";
import { SalaryRule } from "./payroll-models.js";
import { monthBounds } from "./billing-validation.js";
import { AppError } from "./errors.js";
export function safeTotal(values: number[]) {
  if (values.some(v => !Number.isSafeInteger(v)))
    throw new AppError(409, "PAYROLL_CALCULATION_DATA_INVALID", "Hisoblash summalari xavfsiz butun son bo‘lishi kerak.");
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
  if (!rules.length)
    throw new AppError(
      409,
      "NO_SALARY_RULE",
      "Oy boshida amal qiluvchi maosh qoidasini kiriting.",
    );
  if (owned.some(c => !groups.some(g => g._id.equals(c.groupId))) ||
      rules.some(r => r.groupId && !groups.some(g => g._id.equals(r.groupId!))))
    throw new AppError(409, "PAYROLL_GROUP_MISSING", "Hisob yoki maosh qoidasidagi guruh topilmadi. Guruh ma’lumotlarini tekshiring.");
  const scopes = new Set<string>();
  for (const rule of rules) {
    const key = String(rule.groupId ?? "default");
    const valid =
      rule.salaryType === "fixed"
        ? Number.isSafeInteger(rule.fixedAmount) &&
          rule.fixedAmount! >= 0 &&
          rule.percentage == null
        : ["billed", "collected"].includes(rule.salaryType) &&
          rule.fixedAmount == null &&
          rule.percentage != null &&
          Number.isFinite(rule.percentage) &&
          rule.percentage >= 0 &&
          rule.percentage <= 100 &&
          Math.abs(rule.percentage * 100 - Math.round(rule.percentage * 100)) <
            1e-8;
    if (
      !valid ||
      scopes.has(key) ||
      (rule.groupId && !groups.some((g) => g._id.equals(rule.groupId!)))
    )
      throw new AppError(
        409,
        "INVALID_SALARY_SETTINGS",
        "Maosh sozlamalari noto‘g‘ri yoki qoidalar bir-birini qoplaydi. Qoidalarni tekshiring.",
      );
    scopes.add(key);
  }
  const defaults = rules.find((r) => !r.groupId);
  const lines: {
    ruleId: string;
    groupId: string | null;
    groupName: string | null;
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
      groupName: null,
      salaryType: "fixed",
      percentage: null,
      basisAmount: defaults.fixedAmount!,
      salary: defaults.fixedAmount!,
      sourceIds: [],
      legacyAttribution: false,
    });
  const groupIds = new Set([
    ...owned.map((c) => String(c.groupId)),
    ...groups
      .filter(
        (g) =>
          String(g.teacherId) === teacherId &&
          g.status !== "archived" &&
          g.startDate < end,
      )
      .map((g) => String(g._id)),
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
    if (!rule)
      throw new AppError(
        409,
        "GROUP_SALARY_RULE_REQUIRED",
        `${groups.find((g) => String(g._id) === groupId)?.name ?? groupId}: guruh uchun maosh qoidasini kiriting.`,
      );
    if (rule === defaults && rule.salaryType === "fixed") continue;
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
    if (sources.some(s => ("amount" in s ? s.amount : s.finalAmount) < 0))
      throw new AppError(409, "PAYROLL_CALCULATION_DATA_INVALID", "Hisoblash manbasidagi summa manfiy bo‘lmasin.");
    const basis =
      rule.salaryType === "fixed"
        ? rule.fixedAmount!
        : safeTotal(
            sources.map((s) => ("amount" in s ? s.amount : s.finalAmount)),
          );
    lines.push({
      ruleId: rule.id,
      groupId,
      groupName: groups.find((g) => String(g._id) === groupId)?.name ?? groupId,
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
  if (!lines.length && !defaults)
    throw new AppError(
      409,
      "INVALID_SALARY_SETTINGS",
      "O‘qituvchining guruhlari uchun amal qiluvchi maosh qoidasini kiriting.",
    );
  if (!lines.length)
    throw new AppError(409, "PAYROLL_GROUP_MISSING", "Foizli maosh uchun o‘qituvchining hisoblash guruhi topilmadi. Guruh biriktirilganini tekshiring.");
  return {
    policyVersion: "tashkent-charge-owner-v1",
    timezone: "Asia/Tashkent",
    month,
    lines,
    grossSalary: safeTotal(lines.map((l) => l.salary)),
  };
}
