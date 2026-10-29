import { Router } from "express";
import mongoose from "mongoose";
import { Student, type StudentRecord } from "./models.js";
import { principal, requireRoles, tenantScope } from "./security.js";
import { AppError } from "./errors.js";
import {
  studentCreateSchema,
  studentUpdateSchema,
  studentStatusSchema,
  studentListSchema,
  normalizePhone,
  normalizeName,
} from "./student-validation.js";

export function studentView(s: StudentRecord) {
  return {
    id: s._id.toString(),
    firstName: s.firstName,
    lastName: s.lastName,
    phone: s.phone ?? "",
    parentName: s.parentName ?? "",
    parentPhone: s.parentPhone ?? "",
    birthDate: s.birthDate?.toISOString().slice(0, 10) ?? null,
    enrollmentDate: s.enrollmentDate.toISOString().slice(0, 10),
    status: s.status,
    notes: s.notes ?? "",
    createdBy: s.createdBy.toString(),
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}
const notFound = () => new AppError(404, "NOT_FOUND", "O‘quvchi topilmadi.");
const escape = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const studentsRouter = Router();
studentsRouter.use(requireRoles("business_owner", "admin"));
studentsRouter.post("/", async (req, res) => {
  const input = studentCreateSchema.parse(req.body);
  const actor = principal(req);
  const student = await Student.create({
    ...input,
    ...tenantScope(actor),
    createdBy: actor.userId,
  });
  res.status(201).json({ student: studentView(student) });
});
studentsRouter.get("/", async (req, res) => {
  const q = studentListSchema.parse(req.query);
  const filter: mongoose.FilterQuery<StudentRecord> = {
    ...tenantScope(principal(req)),
    ...(q.status ? { status: q.status } : {}),
  };
  if (q.search) {
    const tokens = normalizeName(q.search).split(" ");
    const phone = normalizePhone(q.search);
    filter.$or = [
      {
        $and: tokens.map((token) => ({
          $or: [
            { firstName: new RegExp(escape(token), "i") },
            { lastName: new RegExp(escape(token), "i") },
          ],
        })),
      },
      ...(phone && /^\+?\d+$/.test(phone)
        ? [{ phone: new RegExp(escape(phone)) }]
        : []),
    ];
  }
  const direction = q.sort === "asc" ? 1 : -1;
  const [students, total] = await Promise.all([
    Student.find(filter)
      .sort({ enrollmentDate: direction, _id: direction })
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize),
    Student.countDocuments(filter),
  ]);
  res.json({
    students: students.map(studentView),
    total,
    page: q.page,
    pageSize: q.pageSize,
  });
});
studentsRouter.use("/:id", (req, _res, next) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) throw notFound();
  next();
});
studentsRouter.get("/:id", async (req, res) => {
  const student = await Student.findOne({
    _id: req.params.id,
    ...tenantScope(principal(req)),
  });
  if (!student) throw notFound();
  res.json({ student: studentView(student) });
});
for (const statusOnly of [false, true]) {
  studentsRouter.patch(
    statusOnly ? "/:id/status" : "/:id",
    async (req, res) => {
      const input = (
        statusOnly ? studentStatusSchema : studentUpdateSchema
      ).parse(req.body);
      const student = await Student.findOneAndUpdate(
        { _id: req.params.id, ...tenantScope(principal(req)) },
        { $set: input },
        { new: true, runValidators: true },
      );
      if (!student) throw notFound();
      res.json({ student: studentView(student) });
    },
  );
}
export async function studentStatistics(scope: {
  tenantId: mongoose.Types.ObjectId;
}) {
  const now = new Date();
  const since = new Date(now.getTime() - 30 * 86400000);
  const [total, active, paused, recent] = await Promise.all([
    Student.countDocuments(scope),
    Student.countDocuments({ ...scope, status: "active" }),
    Student.countDocuments({ ...scope, status: "paused" }),
    Student.countDocuments({
      ...scope,
      enrollmentDate: { $gte: since, $lte: now },
    }),
  ]);
  return { total, active, paused, recent };
}
