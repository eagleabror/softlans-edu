import { z } from "zod";
import {
  normalizeName,
  normalizePhone,
  studentCreateSchema,
} from "./student-validation.js";
export const statuses = [
  "new",
  "contacted",
  "trial_scheduled",
  "trial_completed",
  "converted",
  "lost",
] as const;
export const sources = [
  "instagram",
  "telegram",
  "website",
  "referral",
  "walk_in",
  "phone",
  "other",
] as const;
export type LeadStatus = (typeof statuses)[number];
export const transitions: Record<LeadStatus, readonly LeadStatus[]> = {
  new: ["contacted", "lost"],
  contacted: ["trial_scheduled", "converted", "lost"],
  trial_scheduled: ["contacted", "trial_completed", "lost"],
  trial_completed: ["trial_scheduled", "converted", "lost"],
  converted: [],
  lost: ["new"],
};
export const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(
      (v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(v),
      "Matnni tekshiring.",
    );
const phone = z
  .string()
  .max(32)
  .transform(normalizePhone)
  .pipe(z.string().regex(/^\+?\d{7,15}$|^$/, "Telefonni tekshiring."));
export const leadCreate = z
  .object({
    fullName: text(200).min(1).transform(normalizeName),
    phone: phone.default(""),
    parentName: text(100).optional(),
    parentPhone: phone.optional(),
    interestedCourse: text(160).min(1),
    source: z.enum(sources),
    assignedTo: objectId.nullable().optional(),
    notes: text(2000).optional(),
    nextFollowUpAt: z.iso.datetime({ offset: true }).nullable().optional(),
  })
  .strict();
export const leadUpdate = leadCreate
  .extend({ phone })
  .partial()
  .refine((v) => Object.keys(v).length > 0);
export const statusChange = z
  .object({
    status: z.enum(statuses).exclude(["converted"]),
    reason: text(1000).optional(),
  })
  .strict()
  .refine(
    (v) => v.status !== "lost" || !!v.reason,
    "Rad etish sababini kiriting.",
  );
export const paging = {
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(["asc", "desc"]).default("desc"),
};
export const leadList = z
  .object({
    ...paging,
    search: text(100).default(""),
    status: z.enum(statuses).optional(),
    source: z.enum(sources).optional(),
    assignedTo: objectId.optional(),
    archived: z.enum(["true", "false"]).default("false"),
  })
  .strict();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const trialInput = z
  .object({
    leadId: objectId,
    groupId: objectId.nullable().optional(),
    teacherId: objectId.nullable().optional(),
    trialDate: z.iso.date(),
    startTime: time,
    endTime: time,
    result: z
      .enum(["pending", "attended", "absent", "cancelled"])
      .default("pending"),
    notes: text(2000).optional(),
  })
  .strict()
  .refine((v) => v.startTime < v.endTime, "Vaqt oralig‘ini tekshiring.");
export const followInput = z
  .object({
    leadId: objectId,
    assignedTo: objectId,
    dueAt: z.iso.datetime({ offset: true }),
    title: text(200).min(1),
    note: text(2000).optional(),
  })
  .strict();
export const conversion = z
  .object({
    confirmed: z.literal(true),
    existingStudentId: objectId.optional(),
    student: studentCreateSchema.optional(),
  })
  .strict()
  .refine(
    (v) => !!v.existingStudentId !== !!v.student,
    "Yangi o‘quvchi yoki mavjud o‘quvchini tanlang.",
  );
export const conversionRate = (converted: number, total: number) =>
  total === 0 ? 0 : Math.round((converted / total) * 10000) / 100;
export const phoneKey = (value: string) =>
  normalizePhone(value).replace(/^\+/, "");
