import { z } from "zod";

export const normalizeName = (v: string) =>
  v.normalize("NFC").trim().replace(/\s+/gu, " ");
export const normalizePhone = (v: string) => v.replace(/[\s().-]/g, "");
const name = z
  .string()
  .max(100)
  .transform(normalizeName)
  .pipe(
    z
      .string()
      .min(1, "Ismni kiriting.")
      .max(100)
      .regex(/^[\p{L}\p{M} ‘ʼ'’`-]+$/u, "Faqat harflar kiriting."),
  );
const phone = z
  .string()
  .trim()
  .max(32)
  .transform(normalizePhone)
  .pipe(
    z
      .string()
      .regex(/^\+?\d{7,15}$|^$/, "Telefon 7–15 ta raqamdan iborat bo‘lsin."),
  );
const date = z.iso
  .date("Sanani to‘g‘ri kiriting.")
  .refine(
    (v) => v >= "1900-01-01" && v <= new Date().toISOString().slice(0, 10),
    "Sana 1900-yildan bugungacha bo‘lsin.",
  );
export const studentStatus = z.enum(["active", "paused", "archived"]);
export const studentCreateSchema = z
  .object({
    firstName: name,
    lastName: name,
    phone: phone.optional(),
    parentName: name.or(z.literal("")).optional(),
    parentPhone: phone.optional(),
    birthDate: date.nullable().optional(),
    enrollmentDate: date.optional(),
    status: studentStatus.optional(),
    notes: z
      .string()
      .trim()
      .max(2000)
      .refine(
        (v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(v),
        "Matnni tekshiring.",
      )
      .optional(),
  })
  .strict();
export const studentUpdateSchema = studentCreateSchema
  .omit({ status: true })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "O‘zgartirish kiriting.");
export const studentStatusSchema = z.object({ status: studentStatus }).strict();
export const studentListSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().max(100).default(""),
    status: studentStatus.optional(),
    sort: z.enum(["asc", "desc"]).default("desc"),
  })
  .strict();
