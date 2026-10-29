import { z } from "zod";
export const objectId = z.string().regex(/^[a-f\d]{24}$/i);
export const groupStatus = z.enum(["active", "paused", "archived"]);
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((v) => !/[\u0000-\u001f\u007f]/.test(v));
export const groupCreateSchema = z
  .object({
    name: text(120),
    courseName: text(120),
    teacherId: objectId,
    capacity: z.number().int().min(1).max(10000),
    monthlyFee: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    status: groupStatus.default("active"),
    startDate: z.iso.date(),
    description: z.string().trim().max(2000).optional(),
  })
  .strict();
export const groupUpdateSchema = groupCreateSchema
  .partial()
  .extend({ status: groupStatus.optional() })
  .refine((v) => Object.keys(v).length > 0);
export const groupListSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().max(100).default(""),
    status: groupStatus.optional(),
    teacherId: objectId.optional(),
  })
  .strict();
export const memberListSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(["active", "removed"]).default("active"),
  })
  .strict();
