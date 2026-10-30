import { z } from "zod";
import { pageFields } from "./schedule-validation.js";
import { objectId } from "./group-validation.js";
import { billingMonth } from "./billing-validation.js";
const amount = z.coerce.number().int().min(0).max(1_000_000_000_000);
export const debtInput = z
  .object({
    ...pageFields,
    search: z.string().trim().max(100).default(""),
    groupId: objectId.optional(),
    studentId: objectId.optional(),
    month: billingMonth.optional(),
    status: z.enum(["upcoming", "overdue", "1-7", "8-30", "31+"]).optional(),
    minAmount: amount.optional(),
    maxAmount: amount.optional(),
    sort: z.enum(["dueDate", "remainingAmount"]).default("dueDate"),
    order: z.enum(["asc", "desc"]).default("asc"),
  })
  .strict()
  .refine(
    (q) =>
      q.minAmount === undefined ||
      q.maxAmount === undefined ||
      q.minAmount <= q.maxAmount,
    { message: "Summa oralig‘i noto‘g‘ri." },
  );
