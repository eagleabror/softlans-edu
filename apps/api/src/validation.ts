import { z } from "zod";
export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z
  .string()
  .min(12, "Parol kamida 12 ta belgidan iborat bo‘lsin.")
  .refine(
    (v) => Buffer.byteLength(v, "utf8") <= 72,
    "Parol 72 baytdan oshmasin.",
  );
export const nameSchema = z.string().trim().min(2).max(100);
export const registerSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    password: passwordSchema,
    centerName: z.string().trim().min(2).max(120),
  })
  .strict();
export const loginSchema = z
  .object({
    email: emailSchema,
    password: z
      .string()
      .min(1)
      .max(200)
      .refine((v) => Buffer.byteLength(v, "utf8") <= 72),
  })
  .strict();
export const teamSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    password: passwordSchema,
    role: z.enum(["admin", "teacher"]),
  })
  .strict();
