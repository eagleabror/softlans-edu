import { AttendanceEvent } from "./notification-models.js";
import { Router, type Request } from "express";
import mongoose, { type ClientSession } from "mongoose";
import { z } from "zod";
import { LessonSession, AttendanceRecord } from "./attendance-models.js";
import {
  materializeSchedule,
  attendanceCounts,
  rosterAt,
} from "./attendance-service.js";
import { Schedule } from "./schedule-models.js";
import { Group } from "./group-models.js";
import { Student } from "./models.js";
import {
  principal,
  requireRoles,
  tenantScope,
  type Principal,
} from "./security.js";
import { lockScheduling } from "./schedule-lock.js";
import { lockBilling } from "./billing-lock.js";
import { localDate, TIMEZONE, occursBetween } from "./schedule-time.js";
import { AppError } from "./errors.js";
const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const missing = () => new AppError(404, "NOT_FOUND", "Dars topilmadi.");
const conflict = () =>
  new AppError(
    409,
    "ATTENDANCE_CONFLICT",
    "Davomat o‘zgargan. Sahifani yangilab, qayta tekshiring.",
  );
const range = z
  .object({
    start: z.iso.date().default(localDate),
    end: z.iso.date().default(localDate),
    groupId: objectId.optional(),
    studentId: objectId.optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict()
  .refine(
    (q) =>
      q.start <= q.end &&
      q.end <= localDate() &&
      Date.parse(q.end) - Date.parse(q.start) <= 92 * 86400000,
    "Davr 93 kundan oshmasin va kelajakda bo‘lmasin.",
  );
const mark = z
  .object({
    studentId: objectId,
    status: z.enum(["present", "absent", "late", "excused"]),
    note: z.string().trim().max(500).default(""),
  })
  .strict();
const saveInput = z
  .object({
    revision: z.number().int().nonnegative(),
    records: z.array(mark).min(1).max(1000),
  })
  .strict()
  .refine(
    (q) => new Set(q.records.map((r) => r.studentId)).size === q.records.length,
    "Takroriy o‘quvchi.",
  );
export const attendanceRouter = Router();
attendanceRouter.use(requireRoles("business_owner", "admin", "teacher"));
async function authorizedGroups(actor: Principal, tx?: ClientSession) {
  return Group.find({
    ...tenantScope(actor),
    ...(actor.role === "teacher" ? { teacherId: actor.userId } : {}),
  })
    .session(tx ?? null)
    .select("_id startDate");
}
async function sessionFilter(actor: Principal, tx?: ClientSession) {
  const tenant = tenantScope(actor);
  if (actor.role !== "teacher") return tenant;
  const groups = await authorizedGroups(actor, tx);
  const schedules = await Schedule.find({
    ...tenant,
    teacherId: actor.userId,
    groupId: { $in: groups.map((g) => g._id) },
  })
    .session(tx ?? null)
    .select("_id");
  return {
    ...tenant,
    teacherId: actor.userId,
    groupId: { $in: groups.map((g) => g._id) },
    scheduleId: { $in: schedules.map((s) => s._id) },
  };
}
function view(s: InstanceType<typeof LessonSession>) {
  return {
    id: s.id as string,
    groupId: s.groupId.toString(),
    scheduleId: s.scheduleId.toString(),
    teacherId: s.teacherId.toString(),
    groupName: s.groupName,
    lessonDate: s.lessonDate,
    startTime: s.startTime,
    endTime: s.endTime,
    status: s.status,
    revision: s.revision,
    rosterCount: s.roster.length,
  };
}
async function locked<T>(
  actor: Principal,
  fn: (tx: ClientSession) => Promise<T>,
) {
  return mongoose.connection.transaction(async (tx) => {
    await lockScheduling(tenantScope(actor).tenantId, tx);
    await lockBilling(tenantScope(actor).tenantId, tx);
    return fn(tx);
  });
}
async function generate(
  actor: Principal,
  start: string,
  end: string,
  tx: ClientSession,
  scheduleId?: string,
  groupId?: string,
) {
  const groups = await authorizedGroups(actor, tx);
  const schedules = await Schedule.find({
    ...tenantScope(actor),
    status: "active",
    groupId: groupId
      ? { $in: groups.filter((g) => g.id === groupId).map((g) => g._id) }
      : { $in: groups.map((g) => g._id) },
    ...(actor.role === "teacher" ? { teacherId: actor.userId } : {}),
    ...(scheduleId ? { _id: scheduleId } : {}),
  }).session(tx);
  for (const s of schedules) await materializeSchedule(s, end, tx, start);
}
attendanceRouter.post("/sessions", async (req, res) => {
  const q = z
    .object({
      scheduleId: objectId,
      lessonDate: z.iso.date().refine((d) => d <= localDate()),
    })
    .strict()
    .parse(req.body);
  const actor = principal(req);
  const result = await locked(actor, async (tx) => {
    await generate(actor, q.lessonDate, q.lessonDate, tx, q.scheduleId);
    const s = await LessonSession.findOne({
      ...(await sessionFilter(actor, tx)),
      scheduleId: q.scheduleId,
      lessonDate: q.lessonDate,
    }).session(tx);
    if (!s) throw missing();
    return view(s);
  });
  res.json({ session: result, timezone: TIMEZONE });
});
// Explicit POST keeps occurrence materialization behind existing Origin/JSON CSRF checks.
attendanceRouter.post("/generate", async (req, res) => {
  const q = range.parse(req.body);
  await locked(principal(req), (tx) =>
    generate(principal(req), q.start, q.end, tx, undefined, q.groupId),
  );
  res.status(204).end();
});
async function list(req: Request, overrides: object = {}) {
  const q = range.parse({ ...req.query, ...overrides }),
    actor = principal(req);
  const filter = {
    ...(await sessionFilter(actor)),
    lessonDate: { $gte: q.start, $lte: q.end },
    ...(q.groupId ? { groupId: q.groupId } : {}),
    ...(q.studentId ? { roster: q.studentId } : {}),
  };
  // Do not allow the group filter to override teacher authorization.
  if (
    actor.role === "teacher" &&
    q.groupId &&
    !(await authorizedGroups(actor)).some((g) => g.id === q.groupId)
  )
    throw missing();
  const [rows, total] = await Promise.all([
    LessonSession.find(filter)
      .sort({ lessonDate: -1, startTime: 1, _id: 1 })
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize),
    LessonSession.countDocuments(filter),
  ]);
  return {
    sessions: rows.map(view),
    total,
    page: q.page,
    pageSize: q.pageSize,
    timezone: TIMEZONE,
  };
}
attendanceRouter.get("/today", async (req, res) => {
  const actor = principal(req),
    today = localDate();
  const listed = await list(req, { start: today, end: today });
  const groups = (await authorizedGroups(actor)).filter(
    (g) =>
      (!req.query.groupId || g.id === req.query.groupId) &&
      localDate(g.startDate) <= today,
  );
  const schedules = await Schedule.find({
    ...tenantScope(actor),
    status: "active",
    groupId: { $in: groups.map((g) => g._id) },
    ...(actor.role === "teacher" ? { teacherId: actor.userId } : {}),
  })
    .sort({ startTime: 1, _id: 1 })
    .limit(5001);
  if (schedules.length > 5000)
    throw new AppError(422, "REPORT_LIMIT", "Guruhni tanlang.");
  const lessons = schedules
    .filter((s) => occursBetween(s, today, today))
    .map((s) => ({
      scheduleId: s.id,
      groupId: s.groupId.toString(),
      lessonDate: today,
      startTime: s.startTime,
      endTime: s.endTime,
    }));
  res.json({
    ...listed,
    lessons: lessons.slice(
      (listed.page - 1) * listed.pageSize,
      listed.page * listed.pageSize,
    ),
    totalLessons: lessons.length,
  });
});
attendanceRouter.get("/sessions", async (req, res) =>
  res.json(await list(req)),
);
for (const kind of ["groups", "students"] as const)
  attendanceRouter.get(`/${kind}/:id/history`, async (req, res) => {
    const id = objectId.parse(req.params.id);
    res.json(
      await list(req, kind === "groups" ? { groupId: id } : { studentId: id }),
    );
  });
attendanceRouter.get("/sessions/:id/roster", async (req, res) => {
  const actor = principal(req),
    tenant = tenantScope(actor);
  const s = await LessonSession.findOne({
    _id: objectId.parse(req.params.id),
    ...(await sessionFilter(actor)),
  });
  if (!s) throw missing();
  const students = await Student.find({
    ...tenant,
    _id: { $in: s.roster },
  }).select("firstName lastName");
  const records = await AttendanceRecord.find({ ...tenant, sessionId: s._id });
  res.json({
    session: view(s),
    students: s.roster.map((id) => {
      const student = students.find((st) => st._id.equals(id)),
        r = records.find((r) => r.studentId.equals(id));
      return {
        studentId: id.toString(),
        name: student ? `${student.firstName} ${student.lastName}` : "O‘quvchi",
        status: r?.status ?? null,
        note: r?.note ?? "",
        markedAt: r?.markedAt?.toISOString() ?? null,
      };
    }),
  });
});
for (const method of ["post", "patch"] as const)
  attendanceRouter[method]("/sessions/:id/attendance", async (req, res) => {
    const q = saveInput.parse(req.body),
      actor = principal(req),
      tenant = tenantScope(actor);
    const result = await locked(actor, async (tx) => {
      const s = await LessonSession.findOne({
        _id: objectId.parse(req.params.id),
        ...(await sessionFilter(actor, tx)),
      }).session(tx);
      if (!s) throw missing();
      if (
        s.status === "cancelled" ||
        s.lessonDate > localDate() ||
        s.revision !== q.revision
      )
        throw conflict();
      for (const r of q.records) {
        if (!s.roster.some((id) => id.toString() === r.studentId))
          throw new AppError(
            400,
            "INVALID_MEMBERSHIP",
            "O‘quvchi dars ro‘yxatida yo‘q.",
          );
        const previous = await AttendanceRecord.findOne({
          ...tenant,
          sessionId: s._id,
          studentId: r.studentId,
        }).session(tx);
        if (previous?.status !== r.status)
          await AttendanceEvent.create(
            [
              {
                ...tenant,
                sessionId: s._id,
                studentId: r.studentId,
                revision: s.revision + 1,
                status: r.status,
                correction: !!previous,
              },
            ],
            { session: tx },
          );
        await AttendanceRecord.updateOne(
          { ...tenant, sessionId: s._id, studentId: r.studentId },
          {
            $set: {
              status: r.status,
              note: r.note,
              markedBy: actor.userId,
              markedAt: new Date(),
            },
          },
          { upsert: true, runValidators: true, session: tx },
        );
      }
      const count = await AttendanceRecord.countDocuments({
        ...tenant,
        sessionId: s._id,
      }).session(tx);
      s.revision++;
      s.status = count === s.roster.length ? "completed" : "scheduled";
      await s.save({ session: tx });
      return view(s);
    });
    res.json({ session: result });
  });
attendanceRouter.patch(
  "/sessions/:id",
  requireRoles("business_owner", "admin"),
  async (req, res) => {
    const q = z
      .object({
        revision: z.number().int().nonnegative(),
        status: z.enum(["scheduled", "cancelled"]),
      })
      .strict()
      .parse(req.body);
    const s = await locked(principal(req), async (tx) => {
      const s = await LessonSession.findOne({
        ...tenantScope(principal(req)),
        _id: objectId.parse(req.params.id),
      }).session(tx);
      if (!s) throw missing();
      if (s.revision !== q.revision) throw conflict();
      s.status = q.status;
      if (
        q.status === "scheduled" &&
        s.roster.length > 0 &&
        (await AttendanceRecord.countDocuments({
          tenantId: s.tenantId,
          sessionId: s._id,
        }).session(tx)) === s.roster.length
      )
        s.status = "completed";
      s.revision++;
      await s.save({ session: tx });
      return view(s);
    });
    res.json({ session: s });
  },
);
export async function attendanceSummary(
  actor: Principal,
  start = localDate(),
  end = start,
  groupId?: string,
  studentId?: string,
) {
  return mongoose.connection.transaction(
    async (tx) => {
      const filter = await sessionFilter(actor, tx);
      if (
        actor.role === "teacher" &&
        groupId &&
        !(await authorizedGroups(actor, tx)).some((g) => g.id === groupId)
      )
        throw missing();
      const sessions = await LessonSession.find({
        ...filter,
        lessonDate: { $gte: start, $lte: end },
        ...(groupId ? { groupId } : {}),
        ...(studentId ? { roster: studentId } : {}),
      })
        .session(tx)
        .limit(5001);
      if (sessions.length > 5000)
        throw new AppError(
          422,
          "REPORT_LIMIT",
          "Qisqaroq davr yoki guruhni tanlang.",
        );
      const included = sessions.filter((s) => s.status !== "cancelled");
      const counts = await AttendanceRecord.aggregate<{
        _id: string;
        count: number;
      }>([
        {
          $match: {
            ...tenantScope(actor),
            sessionId: { $in: included.map((s) => s._id) },
            ...(studentId
              ? { studentId: new mongoose.Types.ObjectId(studentId) }
              : {}),
          },
        },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ])
        .session(tx)
        .option({ maxTimeMS: 15000 });
      let pendingOccurrences = 0,
        pendingRosterCount = 0;
      if (start === end && end === localDate() && !studentId) {
        const groups = await authorizedGroups(actor, tx);
        const schedules = await Schedule.find({
          ...tenantScope(actor),
          status: "active",
          groupId: {
            $in: groups
              .filter((g) => !groupId || g.id === groupId)
              .map((g) => g._id),
          },
          ...(actor.role === "teacher" ? { teacherId: actor.userId } : {}),
        }).session(tx);
        const pending = schedules.filter(
          (s) =>
            occursBetween(s, start, end) &&
            !sessions.some((row) => row.scheduleId.equals(s._id)),
        );
        for (const s of pending) {
          const group = await Group.findOne({
            ...tenantScope(actor),
            _id: s.groupId,
          })
            .session(tx)
            .select("startDate");
          if (group && localDate(group.startDate) <= end) {
            pendingOccurrences++;
            pendingRosterCount += (await rosterAt(s, end, tx)).length;
          }
        }
      }
      const totals = attendanceCounts(
        Object.fromEntries(counts.map((r) => [r._id, r.count])),
        included.reduce((n, s) => n + (studentId ? 1 : s.roster.length), 0) +
          pendingRosterCount,
      );
      return {
        ...totals,
        totalSessions: included.length + pendingOccurrences,
        completedSessions: included.filter((s) => s.status === "completed")
          .length,
        awaitingSessions:
          included.filter((s) => s.status === "scheduled").length +
          pendingOccurrences,
        cancelledSessions: sessions.length - included.length,
        timezone: TIMEZONE,
      };
    },
    { readConcern: { level: "snapshot" } },
  );
}
attendanceRouter.get("/summary", async (req, res) => {
  const q = range.parse(req.query);
  res.json(
    await attendanceSummary(
      principal(req),
      q.start,
      q.end,
      q.groupId,
      q.studentId,
    ),
  );
});
