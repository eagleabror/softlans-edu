import { TrialLesson } from "./lead-models.js";
import { materializeSchedule } from "./attendance-service.js";
import { lockBilling } from "./billing-lock.js";
import { Router, type Request } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { Classroom, Schedule } from "./schedule-models.js";
import { Group } from "./group-models.js";
import { User } from "./models.js";
import { principal, requireRoles, tenantScope } from "./security.js";
import { AppError } from "./errors.js";
import { lockScheduling } from "./schedule-lock.js";
import {
  classroomCreate,
  classroomUpdate,
  pageFields,
  scheduleCreate,
  scheduleUpdate,
  scheduleFilters,
  status,
} from "./schedule-validation.js";
import {
  TIMEZONE,
  localDate,
  weekStart,
  addDays,
  occursBetween,
  rangesOverlap,
} from "./schedule-time.js";
const missing = () => new AppError(404, "NOT_FOUND", "Ma’lumot topilmadi.");
const conflict = (message: string) =>
  new AppError(409, "SCHEDULE_CONFLICT", message);
const manage = requireRoles("business_owner", "admin");
const read = requireRoles("business_owner", "admin", "teacher");
export const classroomsRouter = Router();
export const schedulesRouter = Router();
classroomsRouter.use(manage);
schedulesRouter.use(read);
function id(value: unknown) {
  if (!mongoose.isObjectIdOrHexString(value)) throw missing();
  return String(value);
}
function scope(req: Request) {
  const actor = principal(req);
  return {
    ...tenantScope(actor),
    ...(actor.role === "teacher" ? { teacherId: actor.userId } : {}),
  };
}
export function classroomView(c: InstanceType<typeof Classroom>) {
  return {
    id: c.id as string,
    name: c.name,
    capacity: c.capacity ?? null,
    description: c.description ?? "",
    status: c.status,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}
function scheduleView(s: InstanceType<typeof Schedule>) {
  return {
    id: s.id as string,
    groupId: s.groupId.toString(),
    teacherId: s.teacherId.toString(),
    classroomId: s.classroomId.toString(),
    dayOfWeek: s.dayOfWeek,
    startTime: s.startTime,
    endTime: s.endTime,
    effectiveFrom: s.effectiveFrom,
    effectiveUntil: s.effectiveUntil,
    status: s.status,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}
classroomsRouter.get("/", async (req, res) => {
  const q = z
    .object({ ...pageFields, status: status.optional() })
    .strict()
    .parse(req.query);
  const filter = {
    ...tenantScope(principal(req)),
    ...(q.status ? { status: q.status } : {}),
  };
  const [rooms, total] = await Promise.all([
    Classroom.find(filter)
      .sort({ name: 1, _id: 1 })
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize),
    Classroom.countDocuments(filter),
  ]);
  res.json({
    classrooms: rooms.map(classroomView),
    total,
    page: q.page,
    pageSize: q.pageSize,
  });
});
classroomsRouter.get("/:id", async (req, res) => {
  const room = await Classroom.findOne({
    _id: id(req.params.id),
    ...tenantScope(principal(req)),
  });
  if (!room) throw missing();
  res.json({ classroom: classroomView(room) });
});
for (const create of [true, false]) {
  const handler: import("express").RequestHandler = async (req, res) => {
    const input = (create ? classroomCreate : classroomUpdate).parse(req.body);
    const tenant = tenantScope(principal(req));
    const roomId = create
      ? new mongoose.Types.ObjectId().toString()
      : id(req.params.id);
    try {
      const result = await mongoose.connection.transaction(async (session) => {
        await lockScheduling(tenant.tenantId, session);
        const room = create
          ? new Classroom({ ...tenant, _id: roomId })
          : await Classroom.findOne({ ...tenant, _id: roomId }).session(
              session,
            );
        if (!room) throw missing();
        if (
          input.status === "inactive" &&
          (await Schedule.exists({
            ...tenant,
            classroomId: roomId,
            status: "active",
          }).session(session))
        )
          throw conflict(
            "Xona faol darslarga biriktirilgan. Avval dars jadvalini o‘zgartiring.",
          );
        room.set(input);
        if (input.name)
          room.set(
            "nameKey",
            input.name.normalize("NFKC").toLocaleLowerCase("uz"),
          );
        await room.save({ session });
        return classroomView(room);
      });
      res.status(create ? 201 : 200).json({ classroom: result });
    } catch (e) {
      if ((e as { code?: number }).code === 11000)
        throw conflict("Bu nomdagi xona mavjud.");
      throw e;
    }
  };
  if (create) classroomsRouter.post("/", handler);
  else {
    classroomsRouter.patch("/:id", handler);
    classroomsRouter.post(
      "/:id/deactivate",
      (req, _res, next) => {
        z.object({}).strict().parse(req.body);
        req.body = { status: "inactive" };
        next();
      },
      handler,
    );
  }
}
// Deletion is intentionally a status transition, retaining references and history.
const listQuery = z.object({ ...pageFields, ...scheduleFilters }).strict();
function filterFor(req: Request, q: z.infer<typeof listQuery>) {
  const { page: _p, pageSize: _s, ...filters } = q;
  // Teacher identity wins over every client filter, including teacherId.
  if (
    principal(req).role === "teacher" &&
    q.teacherId &&
    q.teacherId !== principal(req).userId.toString()
  )
    throw new AppError(403, "FORBIDDEN", "Ruxsat yo‘q.");
  return { ...filters, ...scope(req) };
}
async function views(
  rows: InstanceType<typeof Schedule>[],
  tenant: ReturnType<typeof tenantScope>,
) {
  const [groups, teachers, rooms] = await Promise.all([
    Group.find({ ...tenant, _id: { $in: rows.map((s) => s.groupId) } }).select(
      "name",
    ),
    User.find({ ...tenant, _id: { $in: rows.map((s) => s.teacherId) } }).select(
      "name",
    ),
    Classroom.find({
      ...tenant,
      _id: { $in: rows.map((s) => s.classroomId) },
    }).select("name"),
  ]);
  return rows.map((s) => ({
    ...scheduleView(s),
    groupName: groups.find((g) => g._id.equals(s.groupId))?.name ?? "—",
    teacherName: teachers.find((t) => t._id.equals(s.teacherId))?.name ?? "—",
    classroomName: rooms.find((c) => c._id.equals(s.classroomId))?.name ?? "—",
  }));
}
schedulesRouter.get("/", async (req, res) => {
  const q = listQuery.parse(req.query),
    filter = filterFor(req, q);
  const [rows, total] = await Promise.all([
    Schedule.find(filter)
      .sort({ dayOfWeek: 1, startTime: 1, _id: 1 })
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize),
    Schedule.countDocuments(filter),
  ]);
  res.json({
    schedules: await views(rows, tenantScope(principal(req))),
    total,
    page: q.page,
    pageSize: q.pageSize,
    timezone: TIMEZONE,
  });
});
schedulesRouter.get("/weekly", async (req, res) => {
  const q = z
    .object({
      ...pageFields,
      ...scheduleFilters,
      date: z.iso.date().default(localDate()),
    })
    .strict()
    .parse(req.query);
  const start = weekStart(q.date),
    end = addDays(start, 6);
  const { date: _date, ...filters } = q;
  const filter = filterFor(req, { ...filters, status: q.status ?? "active" });
  // Date predicates narrow the cursor; weekday occurrences are checked before pagination.
  const cursor = Schedule.find({
    ...filter,
    $and: [
      { $or: [{ effectiveFrom: null }, { effectiveFrom: { $lte: end } }] },
      { $or: [{ effectiveUntil: null }, { effectiveUntil: { $gte: start } }] },
    ],
  })
    .sort({ dayOfWeek: 1, startTime: 1, _id: 1 })
    .cursor();
  const rows: InstanceType<typeof Schedule>[] = [];
  let total = 0;
  for await (const row of cursor)
    if (occursBetween(row, start, end)) {
      if (total >= (q.page - 1) * q.pageSize && rows.length < q.pageSize)
        rows.push(row);
      total++;
    }
  res.json({
    schedules: (await views(rows, tenantScope(principal(req)))).map((s) => ({
      ...s,
      date: addDays(start, s.dayOfWeek - 1),
    })),
    total,
    page: q.page,
    pageSize: q.pageSize,
    weekStart: start,
    weekEnd: end,
    timezone: TIMEZONE,
  });
});
schedulesRouter.get("/:id", async (req, res) => {
  const row = await Schedule.findOne({ _id: id(req.params.id), ...scope(req) });
  if (!row) throw missing();
  res.json({
    schedule: (await views([row], tenantScope(principal(req))))[0],
    timezone: TIMEZONE,
  });
});
for (const create of [true, false]) {
  const handler: import("express").RequestHandler = async (req, res) => {
    const input = (create ? scheduleCreate : scheduleUpdate).parse(req.body),
      tenant = tenantScope(principal(req));
    const rowId = create
      ? new mongoose.Types.ObjectId().toString()
      : id(req.params.id);
    const result = await mongoose.connection.transaction(async (session) => {
      await lockScheduling(tenant.tenantId, session);
      const row = create
        ? new Schedule({ ...tenant, _id: rowId })
        : await Schedule.findOne({ ...tenant, _id: rowId }).session(session);
      if (!row) throw missing();
      if (!create) {
        await lockBilling(tenant.tenantId, session);
        await materializeSchedule(row, localDate(), session);
      }
      const assignmentChanged =
        create ||
        (input.groupId !== undefined &&
          input.groupId !== row.groupId?.toString()) ||
        (input.teacherId !== undefined &&
          input.teacherId !== row.teacherId?.toString());
      row.set(input);
      const data = scheduleCreate.parse({
        groupId: row.groupId?.toString(),
        teacherId: row.teacherId?.toString(),
        classroomId: row.classroomId?.toString(),
        dayOfWeek: row.dayOfWeek,
        startTime: row.startTime,
        endTime: row.endTime,
        effectiveFrom: row.effectiveFrom,
        effectiveUntil: row.effectiveUntil,
        status: row.status,
      });
      // Tenant ownership is checked for inactive records too; retirement must not
      // allow callers to store foreign references or fabricate another center’s history.
      {
        const group = await Group.findOne({
          ...tenant,
          _id: data.groupId,
          ...(data.status === "active" ? { status: "active" } : {}),
        }).session(session);
        if (
          !group ||
          !(await User.exists({
            ...tenant,
            _id: data.teacherId,
            role: "teacher",
            ...(data.status === "active" ? { active: true } : {}),
          }).session(session)) ||
          !(await Classroom.exists({
            ...tenant,
            _id: data.classroomId,
            ...(data.status === "active" ? { status: "active" } : {}),
          }).session(session))
        )
          throw missing();
        if (
          (data.status === "active" || assignmentChanged) &&
          group.teacherId.toString() !== data.teacherId
        )
          throw conflict("O‘qituvchi guruhga biriktirilmagan.");
        if (data.status === "active") {
          const trials = await TrialLesson.find({
            ...tenant,
            result: { $ne: "cancelled" },
            startTime: { $lt: data.endTime },
            endTime: { $gt: data.startTime },
            $or: [{ teacherId: data.teacherId }, { groupId: data.groupId }],
          }).session(session);
          if (trials.some((t) => occursBetween(data, t.trialDate, t.trialDate)))
            throw conflict("Sinov darsi bilan to‘qnashuv bor.");
          const candidates = Schedule.find({
            ...tenant,
            _id: { $ne: rowId },
            status: "active",
            dayOfWeek: data.dayOfWeek,
            startTime: { $lt: data.endTime },
            endTime: { $gt: data.startTime },
            $or: [
              { groupId: data.groupId },
              { teacherId: data.teacherId },
              { classroomId: data.classroomId },
            ],
          })
            .session(session)
            .cursor();
          for await (const other of candidates)
            if (rangesOverlap(data, other)) {
              const resource =
                other.groupId.toString() === data.groupId
                  ? "Guruh"
                  : other.teacherId.toString() === data.teacherId
                    ? "O‘qituvchi"
                    : "Xona";
              throw conflict(`${resource} uchun bu vaqtda boshqa dars mavjud.`);
            }
        }
      }
      await row.save({ session });
      return scheduleView(row);
    });
    res
      .status(create ? 201 : 200)
      .json({ schedule: result, timezone: TIMEZONE });
  };
  if (create) schedulesRouter.post("/", manage, handler);
  else {
    schedulesRouter.patch("/:id", manage, handler);
    schedulesRouter.post(
      "/:id/deactivate",
      manage,
      (req, _res, next) => {
        z.object({}).strict().parse(req.body);
        req.body = { status: "inactive" };
        next();
      },
      handler,
    );
  }
}
export async function scheduleStatistics(
  tenant: ReturnType<typeof tenantScope>,
  now = new Date(),
) {
  const today = localDate(now),
    start = weekStart(today),
    end = addDays(start, 6);
  let todayLessons = 0,
    weeklyLessons = 0;
  for await (const s of Schedule.find({
    ...tenant,
    status: "active",
  }).cursor()) {
    if (occursBetween(s, today, today)) todayLessons++;
    if (occursBetween(s, start, end)) weeklyLessons++;
  }
  return {
    todayLessons,
    weeklyLessons,
    activeClassrooms: await Classroom.countDocuments({
      ...tenant,
      status: "active",
    }),
    timezone: TIMEZONE,
  };
}
