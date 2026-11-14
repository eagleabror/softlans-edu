import { Router } from "express";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type {
  StudentAccountView,
  StudentAttendanceView,
  StudentChargesView,
  StudentDashboardView,
  StudentLessonView,
  StudentPaymentsView,
  StudentProfileView,
  StudentScheduleView,
} from "@softlans/contracts";
import { Student, Tenant, User } from "./models.js";
import { Group, Membership } from "./group-models.js";
import { Classroom, Schedule } from "./schedule-models.js";
import { AttendanceRecord, LessonSession } from "./attendance-models.js";
import { Charge, Payment, PaymentReversal } from "./billing-models.js";
import { attendanceTotals } from "./attendance-service.js";
import {
  addDays,
  dayOfWeek,
  localDate,
  TIMEZONE,
  weekStart,
} from "./schedule-time.js";
import {
  currentBillingMonth,
  monthBounds,
  billingMonth,
} from "./billing-validation.js";
import { principal, requireRoles, tenantScope } from "./security.js";
import { emailSchema, passwordSchema } from "./validation.js";
import { lockBilling } from "./billing-lock.js";
import { AppError } from "./errors.js";

const missing = () => new AppError(404, "NOT_FOUND", "O‘quvchi topilmadi.");
const accountView = (
  user: { _id: mongoose.Types.ObjectId; email: string; active: boolean } | null,
): StudentAccountView => ({
  account: user
    ? { id: user._id.toString(), email: user.email, active: user.active }
    : null,
});
export const studentAccountsRouter = Router();
studentAccountsRouter.use(requireRoles("business_owner", "admin"));
studentAccountsRouter.get("/:id/account", async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) throw missing();
  const scope = tenantScope(principal(req));
  if (!(await Student.exists({ ...scope, _id: req.params.id })))
    throw missing();
  const user = await User.findOne({
    ...scope,
    studentId: req.params.id,
    role: "student",
  }).select("email active");
  res.json(accountView(user));
});
studentAccountsRouter.post(
  "/:id/account",
  rateLimit({
    windowMs: 60 * 60_000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, _res, next) =>
      next(
        new AppError(
          429,
          "RATE_LIMITED",
          "Urinishlar ko‘p. Keyinroq urinib ko‘ring.",
        ),
      ),
  }),
  async (req, res) => {
    if (!mongoose.isObjectIdOrHexString(req.params.id)) throw missing();
    const input = z
      .object({ email: emailSchema, password: passwordSchema })
      .strict()
      .parse(req.body);
    const scope = tenantScope(principal(req));
    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await mongoose.connection.transaction(async (session) => {
      // Serialize against student status changes as well as concurrent provisioning.
      await lockBilling(scope.tenantId, session);
      const student = await Student.findOne({
        ...scope,
        _id: req.params.id,
      }).session(session);
      if (!student) throw missing();
      if (student.status === "archived")
        throw new AppError(
          409,
          "STUDENT_ARCHIVED",
          "Avval o‘quvchini faollashtiring.",
        );
      if (
        await User.exists({
          ...scope,
          studentId: student._id,
          role: "student",
        }).session(session)
      )
        throw new AppError(
          409,
          "ACCOUNT_EXISTS",
          "Bu o‘quvchi uchun kabinet allaqachon ochilgan.",
        );
      const [created] = await User.create(
        [
          {
            ...scope,
            studentId: student._id,
            role: "student",
            name: `${student.firstName} ${student.lastName}`.slice(0, 100),
            email: input.email,
            passwordHash,
          },
        ],
        { session },
      );
      return created!;
    });
    res.status(201).json(accountView(user));
  },
);

type Scope = {
  tenantId: mongoose.Types.ObjectId;
  studentId: mongoose.Types.ObjectId;
};
const pageSchema = z.coerce.number().int().min(1).max(10000).default(1);
const monthQuery = z
  .object({
    month: billingMonth.default(currentBillingMonth),
    page: pageSchema,
  })
  .strict();
const pageSize = 20;
const pageInfo = (total: number, page: number) => ({ total, page, pageSize });
const scopeFor = (req: Express.Request): Scope => {
  const actor = principal(req);
  if (!actor.user.studentId) throw missing();
  return { ...tenantScope(actor), studentId: actor.user.studentId };
};

/** Project recurrences without creating sessions; immutable session snapshots take precedence. */
async function lessonsBetween(
  scope: Scope,
  from: string,
  until: string,
  active: boolean,
): Promise<StudentLessonView[]> {
  const { tenantId, studentId } = scope;
  const memberships = await Membership.find({ tenantId, studentId });
  const groups = await Group.find({
    tenantId,
    _id: { $in: memberships.map((m) => m.groupId) },
  });
  const schedules = await Schedule.find({
    tenantId,
    groupId: { $in: groups.map((g) => g._id) },
  });
  const sessions = await LessonSession.find({
    tenantId,
    lessonDate: { $gte: from, $lte: until },
    $or: [
      { roster: studentId },
      { groupId: { $in: groups.map((g) => g._id) } },
    ],
  });
  // A historical roster remains visible even if membership or group records have since changed.
  const historicalSchedules = await Schedule.find({
    tenantId,
    _id: { $in: sessions.map((s) => s.scheduleId) },
  });
  const allSchedules = [...schedules, ...historicalSchedules];
  const [teachers, rooms] = await Promise.all([
    User.find({
      tenantId,
      _id: {
        $in: [
          ...allSchedules.map((s) => s.teacherId),
          ...sessions.map((s) => s.teacherId),
        ],
      },
    }).select("name"),
    Classroom.find({
      tenantId,
      _id: { $in: allSchedules.map((s) => s.classroomId) },
    }).select("name"),
  ]);
  const teacherName = (id: mongoose.Types.ObjectId) =>
    teachers.find((t) => t._id.equals(id))?.name ?? "—";
  const classroomName = (id?: mongoose.Types.ObjectId) =>
    rooms.find((r) => id && r._id.equals(id))?.name ?? "—";
  const lessons = new Map<string, StudentLessonView>();
  if (active)
    for (const schedule of schedules) {
      const group = groups.find((g) => g._id.equals(schedule.groupId));
      if (!group || group.status !== "active" || schedule.status !== "active")
        continue;
      for (let date = from; date <= until; date = addDays(date, 1)) {
        if (
          dayOfWeek(date) !== schedule.dayOfWeek ||
          date < localDate(group.startDate) ||
          date < localDate(schedule.createdAt) ||
          (schedule.effectiveFrom && date < schedule.effectiveFrom) ||
          (schedule.effectiveUntil && date > schedule.effectiveUntil)
        )
          continue;
        const instant = new Date(`${date}T${schedule.startTime}:00+05:00`);
        const eligible = memberships.some(
          (m) =>
            m.groupId.equals(group._id) &&
            m.enrolledAt <= instant &&
            (m.status === "active" || (m.removedAt ?? m.updatedAt) > instant),
        );
        if (!eligible) continue;
        const key = `${schedule._id}/${date}`;
        lessons.set(key, {
          key,
          groupId: group.id,
          groupName: group.name,
          courseName: group.courseName,
          date,
          startTime: schedule.startTime,
          endTime: schedule.endTime,
          teacherName: teacherName(schedule.teacherId),
          classroomName: classroomName(schedule.classroomId),
          status: "scheduled",
        });
      }
    }
  for (const session of sessions) {
    const key = `${session.scheduleId}/${session.lessonDate}`;
    // An existing snapshot also owns the roster: do not project a lesson the student never attended.
    if (!session.roster.some((id) => id.equals(studentId))) {
      lessons.delete(key);
      continue;
    }
    const schedule = allSchedules.find((s) => s._id.equals(session.scheduleId));
    const group = groups.find((g) => g._id.equals(session.groupId));
    lessons.set(key, {
      key,
      groupId: session.groupId.toString(),
      groupName: session.groupName,
      courseName: group?.courseName ?? "",
      date: session.lessonDate,
      startTime: session.startTime,
      endTime: session.endTime,
      teacherName: teacherName(session.teacherId),
      classroomName: classroomName(schedule?.classroomId),
      status: session.status,
    });
  }
  return [...lessons.values()].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.startTime.localeCompare(b.startTime) ||
      a.key.localeCompare(b.key),
  );
}
async function studentAttendance(
  scope: Scope,
  month: string,
  page: number,
): Promise<StudentAttendanceView> {
  const { start, end } = monthBounds(month);
  const sessions = await LessonSession.find({
    tenantId: scope.tenantId,
    roster: scope.studentId,
    lessonDate: { $gte: localDate(start), $lt: localDate(end) },
  }).sort({ lessonDate: -1, startTime: -1, _id: -1 });
  const records = await AttendanceRecord.find({
    ...scope,
    sessionId: { $in: sessions.map((s) => s._id) },
  }).select("sessionId status");
  const recordBySession = new Map(
    records.map((r) => [r.sessionId.toString(), r.status]),
  );
  const elapsed = sessions.filter(
    (s) =>
      s.status !== "cancelled" &&
      new Date(`${s.lessonDate}T${s.startTime}:00+05:00`) <= new Date(),
  );
  const summary = attendanceTotals(
    elapsed.flatMap((s) => recordBySession.get(s.id) ?? []),
    elapsed.length,
  );
  return {
    month,
    summary,
    ...pageInfo(sessions.length, page),
    lessons: sessions
      .slice((page - 1) * pageSize, page * pageSize)
      .map((s) => ({
        id: s.id,
        date: s.lessonDate,
        startTime: s.startTime,
        endTime: s.endTime,
        groupName: s.groupName,
        lessonStatus: s.status,
        status:
          s.status === "cancelled" ? null : (recordBySession.get(s.id) ?? null),
      })),
  };
}
async function financialSummary(scope: Scope, month?: string) {
  const [row] = await Charge.aggregate<{
    billed: number;
    paid: number;
    remaining: number;
  }>([
    {
      $match: {
        ...scope,
        cancelled: false,
        ...(month ? { billingMonth: month } : {}),
      },
    },
    {
      $group: {
        _id: null,
        billed: { $sum: "$finalAmount" },
        paid: { $sum: "$paidAmount" },
        remaining: { $sum: { $subtract: ["$finalAmount", "$paidAmount"] } },
      },
    },
    { $project: { _id: 0, billed: 1, paid: 1, remaining: 1 } },
  ]);
  return row ?? { billed: 0, paid: 0, remaining: 0 };
}

export const studentPortalRouter = Router();
studentPortalRouter.use(requireRoles("student"));
studentPortalRouter.get("/profile", async (req, res) => {
  z.object({}).strict().parse(req.query);
  const { tenantId, studentId } = scopeFor(req);
  const [student, tenant] = await Promise.all([
    Student.findOne({ tenantId, _id: studentId }),
    Tenant.findById(tenantId).select("name"),
  ]);
  if (!student || !tenant) throw missing();
  res.json({
    name: `${student.firstName} ${student.lastName}`,
    email: principal(req).user.email,
    phone: student.phone ?? "",
    centerName: tenant.name,
    status: student.status,
    enrollmentDate: student.enrollmentDate.toISOString().slice(0, 10),
  } satisfies StudentProfileView);
});
studentPortalRouter.get("/schedule", async (req, res) => {
  const q = z
    .object({
      date: z.iso
        .date()
        .refine(
          (date) => date >= "2000-01-01" && date <= "2199-12-31",
          "Sana 2000–2199-yillar oralig‘ida bo‘lsin.",
        )
        .default(localDate),
    })
    .strict()
    .parse(req.query);
  const from = weekStart(q.date),
    until = addDays(from, 6);
  const scope = scopeFor(req);
  const student = await Student.findOne({
    tenantId: scope.tenantId,
    _id: scope.studentId,
  }).select("status");
  res.json({
    lessons: await lessonsBetween(
      scope,
      from,
      until,
      student?.status === "active",
    ),
    weekStart: from,
    weekEnd: until,
    timezone: TIMEZONE,
  } satisfies StudentScheduleView);
});
studentPortalRouter.get("/attendance", async (req, res) => {
  const q = monthQuery.parse(req.query);
  res.json(await studentAttendance(scopeFor(req), q.month, q.page));
});
studentPortalRouter.get("/charges", async (req, res) => {
  const q = monthQuery.parse(req.query),
    scope = scopeFor(req);
  const filter = { ...scope, billingMonth: q.month };
  const [charges, total, summary] = await Promise.all([
    Charge.find(filter)
      .sort({ dueDate: 1, _id: 1 })
      .skip((q.page - 1) * pageSize)
      .limit(pageSize),
    Charge.countDocuments(filter),
    financialSummary(scope, q.month),
  ]);
  const groups = await Group.find({
    tenantId: scope.tenantId,
    _id: { $in: charges.map((c) => c.groupId) },
  }).select("name");
  res.json({
    month: q.month,
    ...pageInfo(total, q.page),
    summary,
    charges: charges.map((c) => {
      const remainingAmount = c.cancelled ? 0 : c.finalAmount - c.paidAmount;
      return {
        id: c.id,
        groupName: groups.find((g) => g._id.equals(c.groupId))?.name ?? "—",
        billingMonth: c.billingMonth,
        finalAmount: c.finalAmount,
        paidAmount: c.paidAmount,
        remainingAmount,
        status: c.cancelled
          ? "cancelled"
          : remainingAmount === 0
            ? "paid"
            : c.paidAmount
              ? "partial"
              : "unpaid",
        dueDate: c.dueDate.toISOString(),
      };
    }),
  } satisfies StudentChargesView);
});
studentPortalRouter.get("/payments", async (req, res) => {
  const q = monthQuery.parse(req.query),
    scope = scopeFor(req),
    bounds = monthBounds(q.month);
  const filter = { ...scope, paidAt: { $gte: bounds.start, $lt: bounds.end } };
  const [payments, total] = await Promise.all([
    Payment.find(filter)
      .sort({ paidAt: -1, _id: -1 })
      .skip((q.page - 1) * pageSize)
      .limit(pageSize),
    Payment.countDocuments(filter),
  ]);
  const reversals = await PaymentReversal.find({
    tenantId: scope.tenantId,
    paymentId: { $in: payments.map((p) => p._id) },
  }).select("paymentId");
  res.json({
    month: q.month,
    ...pageInfo(total, q.page),
    payments: payments.map((p) => ({
      id: p.id,
      amount: p.amount,
      method: p.method,
      paidAt: p.paidAt.toISOString(),
      reversed: reversals.some((r) => r.paymentId.equals(p._id)),
    })),
  } satisfies StudentPaymentsView);
});
studentPortalRouter.get("/dashboard", async (req, res) => {
  z.object({}).strict().parse(req.query);
  const scope = scopeFor(req),
    month = currentBillingMonth(),
    today = localDate();
  const student = await Student.findOne({
    tenantId: scope.tenantId,
    _id: scope.studentId,
  }).select("status");
  const members = await Membership.find({
    ...scope,
    status: "active",
    enrolledAt: { $lte: new Date() },
  }).select("groupId");
  const groups = await Group.find({
    tenantId: scope.tenantId,
    _id: { $in: members.map((m) => m.groupId) },
    status: "active",
  });
  const [teachers, attendance, financial, due, lessons] = await Promise.all([
    User.find({
      tenantId: scope.tenantId,
      _id: { $in: groups.map((g) => g.teacherId) },
    }).select("name"),
    studentAttendance(scope, month, 1),
    financialSummary(scope),
    Charge.findOne({
      ...scope,
      cancelled: false,
      $expr: { $gt: ["$finalAmount", "$paidAmount"] },
    })
      .sort({ dueDate: 1, _id: 1 })
      .select("dueDate"),
    lessonsBetween(
      scope,
      today,
      addDays(today, 6),
      student?.status === "active",
    ),
  ]);
  res.json({
    month,
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      courseName: g.courseName,
      teacherName: teachers.find((t) => t._id.equals(g.teacherId))?.name ?? "—",
    })),
    attendance: attendance.summary,
    outstandingAmount: financial.remaining,
    nextDueDate: due?.dueDate.toISOString() ?? null,
    nextLesson:
      lessons.find(
        (l) =>
          l.status === "scheduled" &&
          new Date(`${l.date}T${l.startTime}:00+05:00`) >= new Date(),
      ) ?? null,
  } satisfies StudentDashboardView);
});
