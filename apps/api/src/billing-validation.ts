import { z } from "zod";
import { objectId } from "./group-validation.js";
import { pageFields } from "./schedule-validation.js";
export const billingMonth = z
  .string()
  .regex(/^(20\d{2}|21\d{2})-(0[1-9]|1[0-2])$/);
export const money = z.number().int().min(0).max(1_000_000_000_000);
export const reason = z
  .string()
  .trim()
  .min(3)
  .max(1000)
  .refine((v) => !/[\u0000-\u001f\u007f]/.test(v));
export const paymentInput = z
  .object({
    chargeId: objectId,
    amount: money.min(1),
    method: z.enum(["cash", "bank_transfer", "click_manual"]),
    paidAt: z.iso.datetime({ offset: true }),
    reference: z.string().trim().max(200).optional(),
    note: z.string().trim().max(1000).optional(),
    idempotencyKey: z.string().uuid(),
    confirmed: z.literal(true),
  })
  .strict();
export const listInput = z
  .object({
    ...pageFields,
    month: billingMonth.optional(),
    studentId: objectId.optional(),
    groupId: objectId.optional(),
    search: z.string().trim().max(100).default(""),
    status: z.enum(["unpaid", "partial", "paid", "cancelled"]).optional(),
  })
  .strict();
export function monthBounds(month: string) {
  billingMonth.parse(month);
  const start = new Date(`${month}-01T00:00:00+05:00`);
  // UTC date may be the previous month; calculate next local month explicitly.
  const [year, m] = month.split("-").map(Number);
  const end = new Date(Date.UTC(year!, m!, 1) - 5 * 3600_000);
  return { start, end };
}
export function currentBillingMonth(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
  }).format(now);
}
