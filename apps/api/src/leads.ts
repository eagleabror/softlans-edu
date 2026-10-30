import { LessonSession } from "./attendance-models.js";
import { Router, type Request } from "express";
import mongoose, { type ClientSession } from "mongoose";
import { z } from "zod";
import { Lead, TrialLesson, FollowUp, LeadHistory } from "./lead-models.js";
import { Student, User } from "./models.js";
import { Group } from "./group-models.js";
import { Schedule } from "./schedule-models.js";
import { principal, requireRoles, tenantScope } from "./security.js";
import { AppError } from "./errors.js";
import { lockScheduling } from "./schedule-lock.js";
import { lockBilling } from "./billing-lock.js";
import { localDate, dayOfWeek, occursBetween } from "./schedule-time.js";
import {
  leadCreate,
  leadUpdate,
  statusChange,
  leadList,
  transitions,
  conversion,
  conversionRate,
  phoneKey,
  objectId,
  trialInput,
  followInput,
  paging,
} from "./lead-validation.js";
const missing = () => new AppError(404, "NOT_FOUND", "Ma’lumot topilmadi.");
const conflict = (message: string) =>
  new AppError(409, "CRM_CONFLICT", message);
const scope = (req: Request) => tenantScope(principal(req));
const id = (v: unknown) => objectId.parse(v);
export function view(row: { toObject: () => Record<string, unknown> }) {
  const { _id, tenantId, __v, phoneKey, ...data } = row.toObject();
  return { id: String(_id), ...data };
}
async function staff(
  tenant: ReturnType<typeof scope>,
  staffId: unknown,
  session?: ClientSession,
) {
  if (!staffId) return;
  if (
    !(await User.exists({
      ...tenant,
      _id: staffId,
      active: true,
      role: { $in: ["business_owner", "admin"] },
    }).session(session ?? null))
  )
    throw missing();
}
async function activeLead(
  req: Request,
  leadId: unknown,
  session: ClientSession,
) {
  const row = await Lead.findOne({
    ...scope(req),
    _id: id(leadId),
    archivedAt: null,
  }).session(session);
  if (!row) throw missing();
  return row;
}
async function audit(
  req: Request,
  leadId: unknown,
  action: string,
  session: ClientSession,
  extra = {},
) {
  await LeadHistory.create(
    [
      {
        ...scope(req),
        leadId,
        actorId: principal(req).userId,
        action,
        ...extra,
      },
    ],
    { session },
  );
}
export const leadsRouter = Router();
leadsRouter.use(requireRoles("business_owner", "admin"));
leadsRouter.get("/staff", async (req, res) => {
  const users = await User.find({
    ...scope(req),
    active: true,
    role: { $in: ["business_owner", "admin"] },
  })
    .select("name")
    .sort({ name: 1 });
  res.json({ staff: users.map((u) => ({ id: u.id, name: u.name })) });
});
leadsRouter.get("/resources", async (req, res) => {
  const [groups, teachers] = await Promise.all([
    Group.find({ ...scope(req), status: "active" })
      .sort({ name: 1 })
      .limit(100),
    User.find({ ...scope(req), role: "teacher", active: true })
      .sort({ name: 1 })
      .limit(100),
  ]);
  res.json({
    groups: groups.map((g) => ({ id: g.id, name: g.name })),
    teachers: teachers.map((t) => ({ id: t.id, name: t.name })),
  });
});
leadsRouter.get("/statistics", async (req, res) =>
  res.json(await leadStatistics(scope(req))),
);
leadsRouter.get("/", async (req, res) => {
  const q = leadList.parse(req.query);
  const filter: mongoose.FilterQuery<unknown> = {
    ...scope(req),
    archivedAt: q.archived === "true" ? { $ne: null } : null,
    ...(q.status ? { status: q.status } : {}),
    ...(q.source ? { source: q.source } : {}),
    ...(q.assignedTo ? { assignedTo: q.assignedTo } : {}),
  };
  if (q.search) {
    const escaped = q.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [
      { fullName: new RegExp(escaped, "i") },
      ...(phoneKey(q.search).match(/^\d+$/)
        ? [{ phoneKey: new RegExp(phoneKey(q.search)) }]
        : []),
    ];
  }
  const direction = q.sort === "asc" ? 1 : -1;
  const [items, total] = await Promise.all([
    Lead.find(filter)
      .sort({ createdAt: direction, _id: direction })
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize),
    Lead.countDocuments(filter),
  ]);
  res.json({
    items: items.map(view),
    total,
    page: q.page,
    pageSize: q.pageSize,
  });
});
leadsRouter.post("/", async (req, res) => {
  const input = leadCreate.parse(req.body);
  const row = await mongoose.connection.transaction(async (session) => {
    await lockBilling(scope(req).tenantId, session);
    await staff(scope(req), input.assignedTo, session);
    const [row] = await Lead.create(
      [{ ...input, ...scope(req), createdBy: principal(req).userId }],
      { session },
    );
    await audit(req, row!._id, "created", session);
    return row!;
  });
  res.status(201).json({ lead: view(row) });
});
leadsRouter.get("/:id/duplicates", async (req, res) => {
  const lead = await Lead.findOne({ ...scope(req), _id: id(req.params.id) });
  if (!lead) throw missing();
  const key = phoneKey(lead.phone);
  const [leads, students] = key
    ? await Promise.all([
        Lead.find({
          ...scope(req),
          _id: { $ne: lead._id },
          phoneKey: key,
        }).limit(20),
        Student.find({
          ...scope(req),
          $or: [{ phone: key }, { phone: "+" + key }],
        }).limit(20),
      ])
    : [[], []];
  res.json({
    leads: leads.map(view),
    students: students.map((s) => ({
      id: s.id,
      firstName: s.firstName,
      lastName: s.lastName,
      phone: s.phone,
      status: s.status,
    })),
  });
});
leadsRouter.get("/:id/history", async (req, res) => {
  const q = z.object(paging).strict().parse(req.query);
  const filter = { ...scope(req), leadId: id(req.params.id) };
  if (!(await Lead.exists({ ...scope(req), _id: filter.leadId })))
    throw missing();
  res.json({
    items: (
      await LeadHistory.find(filter)
        .sort({
          createdAt: q.sort === "asc" ? 1 : -1,
          _id: q.sort === "asc" ? 1 : -1,
        })
        .skip((q.page - 1) * q.pageSize)
        .limit(q.pageSize)
    ).map(view),
    total: await LeadHistory.countDocuments(filter),
  });
});
leadsRouter.get("/:id", async (req, res) => {
  const row = await Lead.findOne({ ...scope(req), _id: id(req.params.id) });
  if (!row) throw missing();
  res.json({ lead: view(row) });
});
for (const action of ["edit", "status", "archive", "assign"] as const) {
  leadsRouter.patch(
    action === "edit" ? "/:id" : `/:id/${action}`,
    async (req, res) => {
      const input =
        action === "edit"
          ? leadUpdate.parse(req.body)
          : action === "status"
            ? statusChange.parse(req.body)
            : action === "assign"
              ? z
                  .object({ assignedTo: objectId.nullable() })
                  .strict()
                  .parse(req.body)
              : z.object({}).strict().parse(req.body);
      const row = await mongoose.connection.transaction(async (session) => {
        await lockBilling(scope(req).tenantId, session);
        const row = await activeLead(req, req.params.id, session);
        if (row.status === "converted" && action !== "archive")
          throw conflict(
            "Konvertatsiya qilingan leadni o‘zgartirib bo‘lmaydi.",
          );
        if ("assignedTo" in input)
          await staff(scope(req), input.assignedTo, session);
        if ("status" in input) {
          if (!transitions[row.status].includes(input.status))
            throw conflict("Bu status o‘tishiga ruxsat yo‘q.");
          await audit(req, row._id, action, session, {
            fromStatus: row.status,
            toStatus: input.status,
            reason: input.reason,
          });
          row.status = input.status;
          row.statusChangedAt = new Date();
        } else {
          row.set(action === "archive" ? { archivedAt: new Date() } : input);
          await audit(req, row._id, action, session);
        }
        await row.save({ session });
        return row;
      });
      res.json({ lead: view(row) });
    },
  );
}
leadsRouter.post("/:id/convert", async (req, res) => {
  const input = conversion.parse(req.body);
  const result = await mongoose.connection.transaction(async (session) => {
    await lockBilling(scope(req).tenantId, session);
    const lead = await activeLead(req, req.params.id, session);
    if (lead.convertedStudentId || lead.status === "converted")
      throw conflict("Lead allaqachon o‘quvchiga aylantirilgan.");
    if (!transitions[lead.status].includes("converted"))
      throw conflict(
        "Avval mijoz bilan bog‘laning yoki sinov darsini yakunlang.",
      );
    let student;
    if (input.existingStudentId) {
      student = await Student.findOne({
        ...scope(req),
        _id: input.existingStudentId,
        status: { $ne: "archived" },
      }).session(session);
      if (!student) throw missing();
    } else {
      const data = input.student!;
      const key = phoneKey(data.phone || lead.phone);
      if (
        key &&
        (await Student.exists({
          ...scope(req),
          $or: [{ phone: key }, { phone: "+" + key }],
        }).session(session))
      )
        throw conflict(
          "Bu telefondagi o‘quvchi mavjud. Dublikatni tekshirib, mavjud o‘quvchi bilan bog‘lang.",
        );
      [student] = await Student.create(
        [{ ...data, ...scope(req), createdBy: principal(req).userId }],
        { session },
      );
    }
    lead.convertedStudentId = student!._id;
    const fromStatus = lead.status;
    lead.status = "converted";
    lead.statusChangedAt = new Date();
    await lead.save({ session });
    await audit(req, lead._id, "converted", session, {
      fromStatus,
      toStatus: "converted",
    });
    return { lead: view(lead), studentId: student!.id };
  });
  res.json(result);
});
export const trialsRouter = Router();
trialsRouter.use(requireRoles("business_owner", "admin"));
export const followUpsRouter = Router();
followUpsRouter.use(requireRoles("business_owner", "admin"));
const filters = z
  .object({
    ...paging,
    leadId: objectId.optional(),
    assignedTo: objectId.optional(),
    date: z.iso.date().optional(),
    bucket: z.enum(["today", "overdue", "upcoming"]).optional(),
  })
  .strict();
for (const isTrial of [true, false]) {
  const router = isTrial ? trialsRouter : followUpsRouter;
  router.get("/", async (req, res) => {
    const q = filters.parse(req.query);
    const today = localDate();
    const start = new Date(today + "T00:00:00+05:00");
    const end = new Date(start.getTime() + 86400000);
    const filter = {
      ...scope(req),
      ...(q.leadId ? { leadId: q.leadId } : {}),
      ...(q.assignedTo
        ? { [isTrial ? "teacherId" : "assignedTo"]: q.assignedTo }
        : {}),
      ...(isTrial && q.date ? { trialDate: q.date } : {}),
      ...(!isTrial && q.bucket
        ? {
            status: "pending",
            dueAt:
              q.bucket === "today"
                ? { $gte: start, $lt: end }
                : q.bucket === "overdue"
                  ? { $lt: new Date() }
                  : { $gte: end },
          }
        : {}),
    };
    const d = q.sort === "asc" ? 1 : -1;
    const sort: Record<string, 1 | -1> = {
      [isTrial ? "trialDate" : "dueAt"]: d,
      _id: d,
    };
    const query = isTrial
      ? TrialLesson.find(filter)
          .sort(sort)
          .skip((q.page - 1) * q.pageSize)
          .limit(q.pageSize)
      : FollowUp.find(filter)
          .sort(sort)
          .skip((q.page - 1) * q.pageSize)
          .limit(q.pageSize);
    const items = await query;
    res.json({
      items: items.map(view),
      total: isTrial
        ? await TrialLesson.countDocuments(filter)
        : await FollowUp.countDocuments(filter),
      page: q.page,
      pageSize: q.pageSize,
    });
  });
}
async function checkTrial(
  input: z.infer<typeof trialInput>,
  tenant: ReturnType<typeof scope>,
  session: ClientSession,
  exclude?: string,
) {
  if (
    input.groupId &&
    !(await Group.exists({
      ...tenant,
      _id: input.groupId,
      status: "active",
    }).session(session))
  )
    throw missing();
  if (
    input.teacherId &&
    !(await User.exists({
      ...tenant,
      _id: input.teacherId,
      role: "teacher",
      active: true,
    }).session(session))
  )
    throw missing();
  if (input.result === "cancelled") return;
  const resources = [
    ...(input.teacherId ? [{ teacherId: input.teacherId }] : []),
    ...(input.groupId ? [{ groupId: input.groupId }] : []),
  ];
  if (
    await TrialLesson.exists({
      ...tenant,
      ...(exclude ? { _id: { $ne: exclude } } : {}),
      leadId: input.leadId,
      trialDate: input.trialDate,
      result: { $ne: "cancelled" },
      startTime: { $lt: input.endTime },
      endTime: { $gt: input.startTime },
    }).session(session)
  )
    throw conflict("Lead uchun bu vaqtda boshqa sinov darsi mavjud.");
  if (!resources.length) return;
  if (
    await LessonSession.exists({
      ...tenant,
      lessonDate: input.trialDate,
      status: { $ne: "cancelled" },
      startTime: { $lt: input.endTime },
      endTime: { $gt: input.startTime },
      $or: resources,
    }).session(session)
  )
    throw conflict("Haqiqiy dars sessiyasi bilan to‘qnashuv bor.");
  const schedules = await Schedule.find({
    ...tenant,
    status: "active",
    dayOfWeek: dayOfWeek(input.trialDate),
    startTime: { $lt: input.endTime },
    endTime: { $gt: input.startTime },
    $or: resources,
  }).session(session);
  if (schedules.some((s) => occursBetween(s, input.trialDate, input.trialDate)))
    throw conflict("Haqiqiy dars jadvali bilan to‘qnashuv bor.");
  if (
    await TrialLesson.exists({
      ...tenant,
      ...(exclude ? { _id: { $ne: exclude } } : {}),
      trialDate: input.trialDate,
      result: { $ne: "cancelled" },
      startTime: { $lt: input.endTime },
      endTime: { $gt: input.startTime },
      $or: resources,
    }).session(session)
  )
    throw conflict("Bu vaqtda boshqa sinov darsi mavjud.");
}
for (const create of [true, false]) {
  const handler: import("express").RequestHandler = async (req, res) => {
    const input = trialInput.parse(req.body);
    const row = await mongoose.connection.transaction(async (session) => {
      await lockScheduling(scope(req).tenantId, session);
      await lockBilling(scope(req).tenantId, session);
      if (input.groupId && !input.teacherId) {
        const group = await Group.findOne({
          ...scope(req),
          _id: input.groupId,
        }).session(session);
        if (!group) throw missing();
        input.teacherId = group.teacherId.toString();
      }
      const lead = await activeLead(req, input.leadId, session);
      if (["converted", "lost"].includes(lead.status))
        throw conflict("Yopilgan lead uchun sinov belgilab bo‘lmaydi.");
      const row = create
        ? new TrialLesson({ ...scope(req), createdBy: principal(req).userId })
        : await TrialLesson.findOne({
            ...scope(req),
            _id: id(req.params.id),
            leadId: input.leadId,
          }).session(session);
      if (!row) throw missing();
      await checkTrial(input, scope(req), session, create ? undefined : row.id);
      row.set(input);
      await row.save({ session });
      await audit(
        req,
        input.leadId,
        create ? "trial_created" : "trial_updated",
        session,
      );
      return row;
    });
    res.status(create ? 201 : 200).json({ trial: view(row) });
  };
  if (create) trialsRouter.post("/", handler);
  else trialsRouter.patch("/:id", handler);
}
followUpsRouter.post("/", async (req, res) => {
  const input = followInput.parse(req.body);
  const row = await mongoose.connection.transaction(async (session) => {
    await lockBilling(scope(req).tenantId, session);
    await activeLead(req, input.leadId, session);
    await staff(scope(req), input.assignedTo, session);
    const [row] = await FollowUp.create(
      [{ ...input, ...scope(req), createdBy: principal(req).userId }],
      { session },
    );
    await audit(req, input.leadId, "follow_up_created", session);
    return row!;
  });
  res.status(201).json({ followUp: view(row) });
});
followUpsRouter.patch("/:id", async (req, res) => {
  const input = z
    .object({ status: z.enum(["completed", "cancelled"]) })
    .strict()
    .parse(req.body);
  const row = await mongoose.connection.transaction(async (session) => {
    await lockBilling(scope(req).tenantId, session);
    const row = await FollowUp.findOne({
      ...scope(req),
      _id: id(req.params.id),
      status: "pending",
    }).session(session);
    if (!row) throw missing();
    row.status = input.status;
    await row.save({ session });
    await audit(req, row.leadId, "follow_up_" + input.status, session);
    return row;
  });
  res.json({ followUp: view(row) });
});
export async function leadStatistics(tenant: {
  tenantId: mongoose.Types.ObjectId;
}) {
  const today = localDate();
  const since = new Date(today + "T00:00:00+05:00");
  const until = new Date(since.getTime() + 86400000);
  const month = new Date(today.slice(0, 7) + "-01T00:00:00+05:00");
  const [
    total,
    converted,
    todayNew,
    monthNew,
    todayTrials,
    overdue,
    byStatus,
    bySource,
  ] = await Promise.all([
    Lead.countDocuments(tenant),
    Lead.countDocuments({ ...tenant, status: "converted" }),
    Lead.countDocuments({ ...tenant, createdAt: { $gte: since, $lt: until } }),
    Lead.countDocuments({
      ...tenant,
      createdAt: { $gte: month, $lte: new Date() },
    }),
    TrialLesson.countDocuments({
      ...tenant,
      trialDate: today,
      result: { $ne: "cancelled" },
    }),
    FollowUp.countDocuments({
      ...tenant,
      status: "pending",
      dueAt: { $lt: new Date() },
    }),
    Lead.aggregate([
      { $match: tenant },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    Lead.aggregate([
      { $match: tenant },
      {
        $group: {
          _id: "$source",
          count: { $sum: 1 },
          converted: {
            $sum: { $cond: [{ $eq: ["$status", "converted"] }, 1, 0] },
          },
        },
      },
    ]),
  ]);
  return {
    total,
    converted,
    todayNew,
    monthNew,
    todayTrials,
    overdue,
    conversionRate: conversionRate(converted, total),
    byStatus,
    bySource,
  };
}
