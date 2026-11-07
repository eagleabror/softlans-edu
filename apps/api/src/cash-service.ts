import type { ClientSession, Types } from "mongoose";
import { CashAccount, CashAudit, CashMovement } from "./cash-models.js";
import { AppError } from "./errors.js";

export const cashConflict = (message: string) =>
  new AppError(409, "CASH_CONFLICT", message);
export const cashMissing = () =>
  new AppError(404, "NOT_FOUND", "Ma’lumot topilmadi.");
export function cashDay(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function exactSum(values: number[]) {
  const total = values.reduce((s, n) => s + BigInt(n), 0n);
  if (
    total > BigInt(Number.MAX_SAFE_INTEGER) ||
    total < -BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw cashConflict("Summa chegaradan oshdi.");
  return Number(total);
}
export async function cashBalance(
  tenantId: Types.ObjectId,
  accountId: Types.ObjectId,
  tx: ClientSession,
  before?: string,
) {
  const rows = await CashMovement.find({
    tenantId,
    accountId,
    ...(before ? { date: { $lt: before } } : {}),
  })
    .select("delta")
    .session(tx);
  return exactSum(rows.map((r) => r.delta));
}
export async function cashAudit(
  tenantId: Types.ObjectId,
  recordedBy: Types.ObjectId,
  entityId: string,
  action: string,
  reason: string,
  tx: ClientSession,
  before?: unknown,
  after?: unknown,
) {
  await CashAudit.create(
    [{ tenantId, recordedBy, entityId, action, reason, before, after }],
    { session: tx },
  );
}
export async function postCash(
  data: {
    tenantId: Types.ObjectId;
    recordedBy: Types.ObjectId;
    accountId: string | Types.ObjectId;
    delta: number;
    date: string;
    kind: string;
    sourceId: string;
    reason: string;
    method?: string;
    opening?: boolean;
    reversal?: boolean;
  },
  tx: ClientSession,
) {
  const account = await CashAccount.findOne({
    tenantId: data.tenantId,
    _id: data.accountId,
  }).session(tx);
  if (!account) throw cashMissing();
  if (!data.reversal && !account.active) throw cashConflict("Hisob faol emas.");
  if (
    !data.opening &&
    (!account.openingDate || data.date < account.openingDate)
  )
    throw cashConflict(
      "Avval boshlang‘ich qoldiqni belgilang; sana undan oldin bo‘lmasin.",
    );
  if (
    data.method &&
    ((account.kind === "cash" && data.method !== "cash") ||
      (account.kind === "bank" && data.method === "cash"))
  )
    throw cashConflict("To‘lov usuli hisob turiga mos emas.");
  if (!Number.isSafeInteger(data.delta))
    throw cashConflict("Butun UZS summasini kiriting.");
  const balance = exactSum([
    await cashBalance(data.tenantId, account._id, tx),
    data.delta,
  ]);
  // Negative balances are explicit, because unallocated legacy receipts may exist.
  const { method: _m, opening: _o, reversal: _r, ...entry } = data;
  const [row] = await CashMovement.create(
    [{ ...entry, accountId: account._id }],
    { session: tx },
  );
  await cashAudit(
    data.tenantId,
    data.recordedBy,
    data.sourceId,
    data.kind,
    data.reason,
    tx,
    undefined,
    { movementId: row!.id, delta: data.delta, balance },
  );
  return row!;
}
// Called only inside the source billing/payroll transaction. No historical allocation API.
export async function allocateCash(
  tenantId: Types.ObjectId,
  actor: Types.ObjectId,
  accountId: string | undefined,
  sourceId: string,
  amount: number,
  paidAt: Date,
  method: string,
  kind: "payment" | "salary",
  tx: ClientSession,
) {
  if (!accountId) return;
  await postCash(
    {
      tenantId,
      recordedBy: actor,
      accountId,
      sourceId,
      delta: kind === "payment" ? amount : -amount,
      date: cashDay(paidAt),
      method,
      kind,
      reason: kind === "payment" ? "Ta’lim to‘lovi" : "Maosh to‘lovi",
    },
    tx,
  );
}
export async function reverseAllocatedCash(
  tenantId: Types.ObjectId,
  actor: Types.ObjectId,
  sourceId: string,
  kind: "payment" | "salary",
  reason: string,
  tx: ClientSession,
) {
  const entry = await CashMovement.findOne({
    tenantId,
    sourceId,
    kind,
  }).session(tx);
  if (!entry) return;
  await postCash(
    {
      tenantId,
      recordedBy: actor,
      accountId: entry.accountId,
      sourceId,
      delta: -entry.delta,
      date: cashDay(),
      kind: kind === "payment" ? "payment_reversal" : "salary_reversal",
      reason,
      reversal: true,
    },
    tx,
  );
}
