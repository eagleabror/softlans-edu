import { lockBilling } from "./billing-lock.js";
import { lockScheduling } from "./schedule-lock.js";
import { Schedule } from "./schedule-models.js";
import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { Group, Membership, type GroupRecord } from "./group-models.js";
import { Student, User } from "./models.js";
import { principal, requireRoles, tenantScope } from "./security.js";
import { AppError } from "./errors.js";
import {
  groupCreateSchema,
  groupUpdateSchema,
  groupListSchema,
  memberListSchema,
  objectId,
} from "./group-validation.js";
export function groupView(g: GroupRecord) {
  return {
    id: g._id.toString(),
    name: g.name,
    courseName: g.courseName,
    teacherId: g.teacherId.toString(),
    capacity: g.capacity,
    monthlyFee: g.monthlyFee,
    status: g.status,
    startDate: g.startDate.toISOString().slice(0, 10),
    description: g.description ?? "",
    activeMemberCount: g.activeMemberCount,
    createdAt: g.createdAt.toISOString(),
    updatedAt: g.updatedAt.toISOString(),
  };
}
const missing = () => new AppError(404, "NOT_FOUND", "Ma’lumot topilmadi.");
const conflict = (message: string) =>
  new AppError(409, "GROUP_CONFLICT", message);
const manage = requireRoles("business_owner", "admin");
export const groupsRouter = Router();
groupsRouter.use(requireRoles("business_owner", "admin", "teacher"));
function scope(req: Parameters<typeof principal>[0]) {
  const actor = principal(req);
  return {
    ...tenantScope(actor),
    ...(actor.role === "teacher" ? { teacherId: actor.userId } : {}),
  };
}
async function validateTeacher(
  teacherId: string,
  tenantId: mongoose.Types.ObjectId,
) {
  if (
    !(await User.exists({
      _id: teacherId,
      tenantId,
      role: "teacher",
      active: true,
    }))
  )
    throw missing();
}
groupsRouter.get("/teachers", manage, async (req, res) => {
  const q = z
    .object({
      search: z.string().trim().max(100).default(""),
      page: z.coerce.number().int().min(1).max(10000).default(1),
    })
    .strict()
    .parse(req.query);
  const filter = {
    ...tenantScope(principal(req)),
    role: "teacher",
    active: true,
    ...(q.search
      ? {
          name: new RegExp(
            q.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            "i",
          ),
        }
      : {}),
  };
  const [teachers, total] = await Promise.all([
    User.find(filter)
      .select("name")
      .sort({ name: 1, _id: 1 })
      .skip((q.page - 1) * 20)
      .limit(20),
    User.countDocuments(filter),
  ]);
  res.json({
    teachers: teachers.map((t) => ({ id: t._id.toString(), name: t.name })),
    total,
    page: q.page,
    pageSize: 20,
  });
});
groupsRouter.get("/", async (req, res) => {
  const q = groupListSchema.parse(req.query);
  const filter: mongoose.FilterQuery<GroupRecord> = {
    ...scope(req),
    ...(q.status ? { status: q.status } : {}),
  };
  if (q.teacherId && principal(req).role !== "teacher")
    filter.teacherId = q.teacherId;
  if (q.search) {
    const re = new RegExp(q.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ name: re }, { courseName: re }];
  }
  const [groups, total] = await Promise.all([
    Group.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize),
    Group.countDocuments(filter),
  ]);
  res.json({
    groups: groups.map(groupView),
    total,
    page: q.page,
    pageSize: q.pageSize,
  });
});
groupsRouter.post("/", manage, async (req, res) => {
  const input = groupCreateSchema.parse(req.body),
    tenant = tenantScope(principal(req));
  await validateTeacher(input.teacherId, tenant.tenantId);
  res
    .status(201)
    .json({ group: groupView(await Group.create({ ...input, ...tenant })) });
});
groupsRouter.use("/:id", (req, _res, next) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) throw missing();
  next();
});
groupsRouter.get("/:id", async (req, res) => {
  const group = await Group.findOne({ _id: req.params.id, ...scope(req) });
  if (!group) throw missing();
  const teacher = await User.findOne({
    _id: group.teacherId,
    ...tenantScope(principal(req)),
  }).select("name");
  res.json({
    group: { ...groupView(group), teacherName: teacher?.name ?? "—" },
  });
});
for (const mode of ["update", "archive", "teacher"] as const) {
  const path =
    mode === "update"
      ? "/:id"
      : mode === "archive"
        ? "/:id/archive"
        : "/:id/teacher";
  const handler: import("express").RequestHandler = async (req, res) => {
    const input =
      mode === "archive"
        ? (z.object({}).strict().parse(req.body),
          { status: "archived" as const })
        : mode === "teacher"
          ? z.object({ teacherId: objectId }).strict().parse(req.body)
          : groupUpdateSchema.parse(req.body);
    const tenant = tenantScope(principal(req));
    if ("teacherId" in input && input.teacherId)
      await validateTeacher(input.teacherId, tenant.tenantId);
    const result = await mongoose.connection.transaction(async (session) => {
      await lockScheduling(tenant.tenantId, session);
      await lockBilling(tenant.tenantId, session);
      const g = await Group.findOne({ _id: req.params.id, ...tenant }).session(
        session,
      );
      if (!g) throw missing();
      if (
        "capacity" in input &&
        input.capacity !== undefined &&
        input.capacity < g.activeMemberCount
      )
        throw conflict("Sig‘im a’zolar sonidan kam bo‘lmasin.");
      if (
        (("teacherId" in input &&
          input.teacherId &&
          input.teacherId !== g.teacherId.toString()) ||
          ("status" in input && input.status !== "active")) &&
        (await Schedule.exists({
          ...tenant,
          groupId: g._id,
          status: "active",
        }).session(session))
      )
        throw conflict(
          "Avval guruhning faol dars jadvallarini o‘chiring yoki yakunlang.",
        );
      g.set(input);
      await g.save({ session });
      return groupView(g);
    });
    res.json({ group: result });
  };
  if (mode === "archive") groupsRouter.post(path, manage, handler);
  else groupsRouter.patch(path, manage, handler);
}
groupsRouter.get("/:id/members", async (req, res) => {
  const q = memberListSchema.parse(req.query),
    tenant = tenantScope(principal(req));
  if (!(await Group.exists({ _id: req.params.id, ...scope(req) })))
    throw missing();
  if (principal(req).role === "teacher" && q.status !== "active")
    throw new AppError(403, "FORBIDDEN", "Ruxsat yo‘q.");
  const filter = { ...tenant, groupId: req.params.id, status: q.status };
  const [members, total] = await Promise.all([
    Membership.find(filter)
      .sort({ enrolledAt: -1, _id: -1 })
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize),
    Membership.countDocuments(filter),
  ]);
  const students = await Student.find({
    ...tenant,
    _id: { $in: members.map((m) => m.studentId) },
  }).select("firstName lastName status");
  res.json({
    members: members.map((m) => {
      const s = students.find((s) => s._id.equals(m.studentId));
      return {
        id: m._id.toString(),
        studentId: m.studentId.toString(),
        enrolledAt: m.enrolledAt.toISOString(),
        status: m.status,
        student: s
          ? {
              id: s._id.toString(),
              firstName: s.firstName,
              lastName: s.lastName,
              status: s.status,
            }
          : null,
      };
    }),
    total,
    page: q.page,
    pageSize: q.pageSize,
  });
});
groupsRouter.post("/:id/members", manage, async (req, res) => {
  const { studentId } = z
      .object({ studentId: objectId })
      .strict()
      .parse(req.body),
    tenant = tenantScope(principal(req));
  const member = await mongoose.connection.transaction(async (session) => {
    await lockBilling(tenant.tenantId, session);
    // Write the student too: concurrent archival must serialize with enrollment.
    const student = await Student.findOneAndUpdate(
      { _id: studentId, ...tenant, status: { $ne: "archived" } },
      { $inc: { membershipRevision: 1 } },
      { session, new: true },
    );
    if (!student) throw missing();
    if (
      await Membership.exists({
        ...tenant,
        groupId: req.params.id,
        studentId,
        status: "active",
      }).session(session)
    )
      throw conflict("O‘quvchi allaqachon guruhda.");
    const g = await Group.findOneAndUpdate(
      {
        _id: req.params.id,
        ...tenant,
        status: { $ne: "archived" },
        $expr: { $lt: ["$activeMemberCount", "$capacity"] },
      },
      { $inc: { activeMemberCount: 1 } },
      { session, new: true },
    );
    if (!g) {
      if (
        !(await Group.exists({ _id: req.params.id, ...tenant }).session(
          session,
        ))
      )
        throw missing();
      throw conflict("Guruh arxivlangan yoki sig‘im to‘lgan.");
    }
    const [m] = await Membership.create(
      [{ ...tenant, groupId: g._id, studentId }],
      { session },
    );
    return { id: m!._id.toString(), studentId, status: m!.status };
  });
  res.status(201).json({ membership: member });
});
groupsRouter.post(
  "/:id/members/:studentId/remove",
  manage,
  async (req, res) => {
    z.object({}).strict().parse(req.body);
    if (!mongoose.isObjectIdOrHexString(req.params.studentId)) throw missing();
    const tenant = tenantScope(principal(req));
    await mongoose.connection.transaction(async (session) => {
      await lockBilling(tenant.tenantId, session);
      const m = await Membership.findOneAndUpdate(
        {
          ...tenant,
          groupId: req.params.id,
          studentId: req.params.studentId,
          status: "active",
        },
        { $set: { status: "removed" } },
        { session, new: true },
      );
      if (!m) throw missing();
      const g = await Group.findOneAndUpdate(
        { _id: req.params.id, ...tenant, activeMemberCount: { $gt: 0 } },
        { $inc: { activeMemberCount: -1 } },
        { session },
      );
      if (!g) throw missing();
    });
    res.status(204).end();
  },
);
export async function groupStatistics(tenant: {
  tenantId: mongoose.Types.ObjectId;
}) {
  const [total, active, activeMemberships] = await Promise.all([
    Group.countDocuments(tenant),
    Group.countDocuments({ ...tenant, status: "active" }),
    Membership.countDocuments({ ...tenant, status: "active" }),
  ]);
  return { total, active, activeMemberships };
}
