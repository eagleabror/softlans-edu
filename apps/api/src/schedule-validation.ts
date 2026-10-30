import { z } from "zod";
import { objectId } from "./group-validation.js";
export const status = z.enum(["active", "inactive"]);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((v) => !/[\u0000-\u001f\u007f]/.test(v));
export const classroomCreate = z
  .object({
    name: text(120),
    capacity: z.number().int().min(1).max(10000).nullable().optional(),
    description: z.string().trim().max(2000).optional(),
    status: status.default("active"),
  })
  .strict();
export const classroomUpdate = classroomCreate
  .partial()
  .extend({ status: status.optional() })
  .refine((v) => Object.keys(v).length > 0);
export const scheduleFields = z
  .object({
    groupId: objectId,
    teacherId: objectId,
    classroomId: objectId,
    dayOfWeek: z.number().int().min(1).max(7),
    startTime: time,
    endTime: time,
    effectiveFrom: z.iso.date().nullable().optional(),
    effectiveUntil: z.iso.date().nullable().optional(),
    status: status.default("active"),
  })
  .strict();
export const scheduleCreate = scheduleFields
  .refine((v) => v.startTime < v.endTime, {
    path: ["endTime"],
    message: "Tugash vaqti boshlanishdan keyin bo‘lsin.",
  })
  .refine(
    (v) =>
      !v.effectiveFrom ||
      !v.effectiveUntil ||
      v.effectiveFrom <= v.effectiveUntil,
    { path: ["effectiveUntil"], message: "Sana oralig‘i noto‘g‘ri." },
  );
export const scheduleUpdate = scheduleFields
  .partial()
  .extend({ status: status.optional() })
  .refine((v) => Object.keys(v).length > 0);
export const pageFields = {
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
};
export const scheduleFilters = {
  groupId: objectId.optional(),
  teacherId: objectId.optional(),
  classroomId: objectId.optional(),
  dayOfWeek: z.coerce.number().int().min(1).max(7).optional(),
  status: status.optional(),
};
