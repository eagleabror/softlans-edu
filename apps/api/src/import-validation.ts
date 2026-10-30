import { z } from "zod";
import { studentCreateSchema } from "./student-validation.js";
export const importFields = [
  "firstName",
  "lastName",
  "phone",
  "parentName",
  "parentPhone",
  "birthDate",
  "enrollmentDate",
  "notes",
] as const;
export const mappingSchema = z
  .partialRecord(z.enum(importFields), z.number().int().min(0).max(31))
  .refine(
    (m) =>
      m.firstName !== undefined &&
      m.lastName !== undefined &&
      new Set(Object.values(m)).size === Object.values(m).length,
    "Ism va familiya ustunlarini takrorlamasdan tanlang.",
  );
export type Mapping = z.infer<typeof mappingSchema>;
const aliases = [
  ["ism", "firstname", "name"],
  ["familiya", "lastname", "surname"],
  ["telefon", "phone"],
  ["otaona ismi", "parentname"],
  ["otaona telefoni", "parentphone"],
  ["tugilgan sana", "birthdate"],
  ["royxatdan otgan sana", "qabul sanasi", "enrollmentdate"],
  ["izoh", "notes"],
];
const clean = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .trim();
export function guessMapping(headers: string[]) {
  return Object.fromEntries(
    importFields.flatMap((f, i) => {
      const index = headers.findIndex((h) => aliases[i]!.includes(clean(h)));
      return index < 0 ? [] : [[f, index]];
    }),
  ) as Mapping;
}
function date(value: string) {
  const match = /^(\d{2})[./](\d{2})[./](\d{4})$/.exec(value);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : value;
}
const labels: Record<string, string> = {
  firstName: "Ism",
  lastName: "Familiya",
  phone: "Telefon",
  parentName: "Ota-ona ismi",
  parentPhone: "Ota-ona telefoni",
  birthDate: "Tug‘ilgan sana",
  enrollmentDate: "Qabul sanasi",
  notes: "Izoh",
};
export function validateRow(row: string[], mapping: Mapping) {
  const input: Record<string, string> = {};
  for (const f of importFields) {
    const index = mapping[f];
    if (index === undefined) continue;
    let value = (row[index] ?? "").trim();
    // Phone +digits is data; all other spreadsheet formula prefixes are rejected.
    if (
      /^[=+@-]/.test(value) &&
      !(["phone", "parentPhone"].includes(f) && /^\+?[\d\s().-]+$/.test(value))
    )
      return { errors: [`${labels[f]}: formula yoki xavfli qiymat.`] };
    if (f.endsWith("Date")) {
      if (!value) continue;
      value = date(value);
    }
    input[f] = value;
  }
  const parsed = studentCreateSchema.safeParse(input);
  return parsed.success
    ? { data: parsed.data, errors: [] }
    : {
        errors: parsed.error.issues.map(
          (i) =>
            `${labels[String(i.path[0])] ?? "Maydon"}: ${/^(Invalid|Too |Unrecognized)/.test(i.message) ? "Qiymatni tekshiring; ism va familiya majburiy." : i.message}`,
        ),
      };
}
export function duplicateKey(s: {
  firstName: string;
  lastName: string;
  phone?: string | null;
}) {
  return s.phone
    ? `${s.phone.replace(/^\+/, "")}|${s.firstName.toLowerCase()}|${s.lastName.toLowerCase()}`
    : null;
}
