import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { createApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import { connectDatabase } from "../src/db.js";
import { ensureIndexes, Student, Tenant, User } from "../src/models.js";
import {
  Lead,
  TrialLesson,
  FollowUp,
  LeadHistory,
} from "../src/lead-models.js";
import {
  conversionRate,
  leadCreate,
  transitions,
} from "../src/lead-validation.js";
import { Schedule, Classroom } from "../src/schedule-models.js";
import { Group } from "../src/group-models.js";
import { LessonSession } from "../src/attendance-models.js";
import { Charge } from "../src/billing-models.js";

const origin = "http://localhost:5173";
const secret = randomBytes(48).toString("hex");
let repl: MongoMemoryReplSet;
let app: ReturnType<typeof createApp>;
let tenantA: mongoose.Types.ObjectId;
let tenantB: mongoose.Types.ObjectId;
let ownerId: mongoose.Types.ObjectId;
let owner: string;
let other: string;
let admin: string;
let teacher: string;
let platform: string;
const input = {
  fullName: "Sinov Mijoz",
  phone: "+998 (90) 123-45-67",
  interestedCourse: "Ingliz tili",
  source: "telegram",
};
async function actor(
  role: "business_owner" | "admin" | "teacher" | "super_admin",
  tenantId: mongoose.Types.ObjectId | null,
) {
  const user = await User.create({
    tenantId,
    role,
    name: "Sinov hisobi",
    email: `${new mongoose.Types.ObjectId()}@example.test`,
    passwordHash: "unused-test-hash",
  });
  const token = jwt.sign({ version: 0 }, secret, {
    subject: user.id,
    expiresIn: "1h",
    issuer: "softlans-api",
    audience: "softlans-web",
  });
  return { cookie: `softlans_session=${token}`, id: user._id };
}
function create(c = owner, body: object = input) {
  return request(app)
    .post("/api/leads")
    .set("Cookie", c)
    .set("Origin", origin)
    .send(body);
}
function patch(path: string, body: object, c = owner) {
  return request(app)
    .patch(path)
    .set("Cookie", c)
    .set("Origin", origin)
    .send(body);
}
beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: "7.0.24" },
  });
  await connectDatabase(repl.getUri("softlans_students_test"));
  await ensureIndexes();
});
beforeEach(async () => {
  await Promise.all([
    Student.deleteMany({}),
    Lead.deleteMany({}),
    TrialLesson.deleteMany({}),
    FollowUp.deleteMany({}),
    LeadHistory.deleteMany({}),
    Schedule.deleteMany({}),
    Group.deleteMany({}),
    Classroom.deleteMany({}),
    LessonSession.deleteMany({}),
    Charge.deleteMany({}),
    User.deleteMany({}),
    Tenant.deleteMany({}),
  ]);
  tenantA = (await Tenant.create({ name: "Sinov A" }))._id;
  tenantB = (await Tenant.create({ name: "Sinov B" }))._id;
  const a = await actor("business_owner", tenantA);
  owner = a.cookie;
  ownerId = a.id;
  other = (await actor("business_owner", tenantB)).cookie;
  admin = (await actor("admin", tenantA)).cookie;
  teacher = (await actor("teacher", tenantA)).cookie;
  platform = (await actor("super_admin", null)).cookie;
  app = createApp(
    parseConfig({
      NODE_ENV: "test",
      APP_ORIGIN: origin,
      MONGODB_URI: repl.getUri(),
      JWT_SECRET: secret,
    }),
  );
});
afterAll(async () => {
  await mongoose.disconnect();
  await repl?.stop();
});

const get = (path: string, c = owner) =>
  request(app).get(path).set("Cookie", c);
const post = (path: string, body: object, c = owner) =>
  request(app).post(path).set("Cookie", c).set("Origin", origin).send(body);
async function lead() {
  const r = await create();
  expect(r.status).toBe(201);
  return r.body.lead.id as string;
}
async function ready() {
  const id = await lead();
  expect(
    (await patch(`/api/leads/${id}/status`, { status: "contacted" })).status,
  ).toBe(200);
  return id;
}
const student = {
  firstName: "Sinov",
  lastName: "O‘quvchi",
  phone: "+998901234567",
};
const convert = (id: string, body: object = { confirmed: true, student }) =>
  post(`/api/leads/${id}/convert`, body);
it("creates tenant scoped normalized lead with audit, updates and archives without deleting", async () => {
  const id = await lead();
  const r = await get(`/api/leads/${id}`);
  expect(r.body.lead).toMatchObject({
    fullName: input.fullName,
    phone: "+998901234567",
    status: "new",
  });
  expect(r.body.lead.tenantId).toBeUndefined();
  expect(
    (await patch(`/api/leads/${id}`, { notes: "Qayta qo‘ng‘iroq" })).status,
  ).toBe(200);
  expect((await get(`/api/leads/${id}`)).body.lead.phone).toBe("+998901234567");
  expect((await patch(`/api/leads/${id}`, {})).status).toBe(400);
  expect((await patch(`/api/leads/${id}/archive`, {})).status).toBe(200);
  expect((await get("/api/leads")).body.total).toBe(0);
  expect((await get("/api/leads?archived=true")).body.total).toBe(1);
  expect(await Lead.countDocuments()).toBe(1);
  expect(
    (await get(`/api/leads/${id}/history`)).body.items.map(
      (v: any) => v.action,
    ),
  ).toEqual(["archive", "edit", "created"]);
  expect((await patch(`/api/leads/${id}`, { notes: "x" })).status).toBe(404);
});
it("searches names and formatted phones, filters and paginates deterministically", async () => {
  await lead();
  await create(owner, { ...input, fullName: "Boshqa", source: "website" });
  expect((await get("/api/leads?search=Sinov")).body.total).toBe(1);
  expect(
    (await get("/api/leads?search=%2B998%20(90)%20123-45-67")).body.total,
  ).toBe(2);
  expect(
    (await get("/api/leads?source=website&pageSize=1")).body.items,
  ).toHaveLength(1);
  const a = await get("/api/leads?pageSize=1&page=1"),
    b = await get("/api/leads?pageSize=1&page=2");
  expect(a.body.items[0].id).not.toBe(b.body.items[0].id);
  expect((await get("/api/leads?search=%5B.*")).status).toBe(200);
});
it("detects exact normalized phone duplicates without merging names or no-phone leads", async () => {
  const id = await lead();
  await create();
  const d = await get(`/api/leads/${id}/duplicates`);
  expect(d.body.leads).toHaveLength(1);
  const no = await create(owner, { ...input, phone: "" });
  await create(owner, { ...input, phone: "" });
  expect(
    (await get(`/api/leads/${no.body.lead.id}/duplicates`)).body.leads,
  ).toHaveLength(0);
  expect(await Lead.countDocuments()).toBe(4);
});
it("rejects invalid input, tenant mass assignment and converted status bypass", async () => {
  for (const body of [
    { ...input, tenantId: tenantB },
    { ...input, createdBy: ownerId },
    { ...input, phone: "bad" },
    { ...input, fullName: "" },
    { ...input, notes: "\u0000" },
  ])
    expect((await create(owner, body)).status).toBe(400);
  const id = await lead();
  expect(
    (await patch(`/api/leads/${id}`, { status: "converted" })).status,
  ).toBe(400);
  expect(
    (await patch(`/api/leads/${id}/status`, { status: "converted" })).status,
  ).toBe(400);
  expect((await get("/api/leads?pageSize=101")).status).toBe(400);
});
it("enforces transitions and lost reasons with timestamps and audit", async () => {
  const id = await lead();
  expect(
    (await patch(`/api/leads/${id}/status`, { status: "trial_completed" }))
      .status,
  ).toBe(409);
  expect(
    (await patch(`/api/leads/${id}/status`, { status: "lost" })).status,
  ).toBe(400);
  const r = await patch(`/api/leads/${id}/status`, {
    status: "lost",
    reason: "Vaqti mos emas",
  });
  expect(r.body.lead.statusChangedAt).toBeTruthy();
  expect((await get(`/api/leads/${id}/history`)).body.items[0]).toMatchObject({
    fromStatus: "new",
    toStatus: "lost",
    reason: "Vaqti mos emas",
  });
  expect(
    (await patch(`/api/leads/${id}/status`, { status: "new" })).status,
  ).toBe(200);
  for (const status of ["contacted", "trial_scheduled", "trial_completed"])
    expect((await patch(`/api/leads/${id}/status`, { status })).status).toBe(
      200,
    );
});
it("assigns only same tenant active administrative staff", async () => {
  const id = await lead();
  const own = (await get("/api/leads/staff")).body.staff;
  expect(own.length).toBe(2);
  expect(
    (await patch(`/api/leads/${id}/assign`, { assignedTo: own[0].id })).status,
  ).toBe(200);
  expect((await get(`/api/leads?assignedTo=${own[0].id}`)).body.total).toBe(1);
  const t = await User.findOne({ role: "teacher", tenantId: tenantA });
  expect(
    (await patch(`/api/leads/${id}/assign`, { assignedTo: t!.id })).status,
  ).toBe(404);
  const b = await User.findOne({ tenantId: tenantB });
  expect(
    (await patch(`/api/leads/${id}/assign`, { assignedTo: b!.id })).status,
  ).toBe(404);
});
it("isolates all lead endpoints and blocks teacher and platform roles", async () => {
  const id = await lead();
  for (const c of [teacher, platform]) {
    for (const p of [
      "/api/leads",
      "/api/leads/statistics",
      "/api/leads/staff",
      "/api/trial-lessons",
      "/api/follow-ups",
    ])
      expect((await get(p, c)).status).toBe(403);
    expect((await create(c)).status).toBe(403);
    expect(
      (await post(`/api/leads/${id}/convert`, { confirmed: true, student }, c))
        .status,
    ).toBe(403);
  }
  for (const path of [
    `/api/leads/${id}`,
    `/api/leads/${id}/history`,
    `/api/leads/${id}/duplicates`,
  ])
    expect((await get(path, other)).status).toBe(404);
  expect((await patch(`/api/leads/${id}`, { notes: "x" }, other)).status).toBe(
    404,
  );
  expect(
    (
      await post(
        `/api/leads/${id}/convert`,
        { confirmed: true, student },
        other,
      )
    ).status,
  ).toBe(404);
  expect((await get("/api/leads", other)).body.total).toBe(0);
  expect((await create(admin)).status).toBe(201);
});
it("preserves CSRF and authentication protection", async () => {
  expect(
    (await request(app).post("/api/leads").set("Cookie", owner).send(input))
      .status,
  ).toBe(403);
  expect((await request(app).get("/api/leads")).status).toBe(401);
});
it("converts atomically once without memberships, billing or sessions", async () => {
  const id = await ready();
  const r = await convert(id);
  expect(r.status).toBe(200);
  expect(r.body.lead).toMatchObject({
    status: "converted",
    convertedStudentId: r.body.studentId,
    phone: "+998901234567",
  });
  expect(await Student.countDocuments()).toBe(1);
  expect(await Charge.countDocuments()).toBe(0);
  expect(await LessonSession.countDocuments()).toBe(0);
  expect((await convert(id)).status).toBe(409);
  expect(await Student.countDocuments()).toBe(1);
});
it("serializes concurrent double conversion and competing same-phone leads", async () => {
  const id = await ready();
  const results = await Promise.all([convert(id), convert(id)]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(await Student.countDocuments()).toBe(1);
  const b = await ready();
  expect((await convert(b)).status).toBe(409);
  expect((await get(`/api/leads/${b}`)).body.lead.status).toBe("contacted");
});
it("links an explicitly confirmed existing student and rejects other tenant or archived students", async () => {
  const a = await Student.create({
    ...student,
    tenantId: tenantA,
    createdBy: ownerId,
  });
  const b = await Student.create({
    ...student,
    tenantId: tenantB,
    createdBy: ownerId,
  });
  const id = await ready();
  expect(
    (await convert(id, { confirmed: true, existingStudentId: b.id })).status,
  ).toBe(404);
  expect(
    (await convert(id, { confirmed: false, existingStudentId: a.id })).status,
  ).toBe(400);
  expect(
    (await convert(id, { confirmed: true, existingStudentId: a.id })).status,
  ).toBe(200);
  expect(await Student.countDocuments()).toBe(2);
});
it("rolls back invalid student input and requires a valid pipeline stage", async () => {
  const id = await lead();
  expect((await convert(id)).status).toBe(409);
  await patch(`/api/leads/${id}/status`, { status: "contacted" });
  expect(
    (
      await convert(id, {
        confirmed: true,
        student: { firstName: "123", lastName: "" },
      })
    ).status,
  ).toBe(400);
  expect(await Student.countDocuments()).toBe(0);
  expect((await get(`/api/leads/${id}`)).body.lead.status).toBe("contacted");
});
it("creates, filters and completes follow-ups with tenant isolation and history", async () => {
  const id = await lead();
  const task = {
    leadId: id,
    assignedTo: String(ownerId),
    dueAt: new Date(Date.now() - 60000).toISOString(),
    title: "Bog‘lanish",
  };
  const r = await post("/api/follow-ups", task);
  expect(r.status).toBe(201);
  expect((await get("/api/follow-ups?bucket=overdue")).body.total).toBe(1);
  expect(
    (await get(`/api/follow-ups?assignedTo=${ownerId}&leadId=${id}`)).body
      .total,
  ).toBe(1);
  expect(
    (
      await patch(
        `/api/follow-ups/${r.body.followUp.id}`,
        { status: "completed" },
        other,
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await patch(`/api/follow-ups/${r.body.followUp.id}`, {
        status: "completed",
      })
    ).status,
  ).toBe(200);
  expect((await get("/api/follow-ups?bucket=overdue")).body.total).toBe(0);
  expect(
    (
      await post("/api/follow-ups", {
        ...task,
        assignedTo: new mongoose.Types.ObjectId().toString(),
      })
    ).status,
  ).toBe(404);
  expect((await post("/api/follow-ups", task, other)).status).toBe(404);
});
it("creates, reschedules and cancels trial lessons with results and tenant isolation", async () => {
  const id = await lead();
  const trial = {
    leadId: id,
    trialDate: "2026-11-02",
    startTime: "09:00",
    endTime: "10:00",
  };
  const r = await post("/api/trial-lessons", trial);
  expect(r.status).toBe(201);
  expect(
    (
      await patch(`/api/trial-lessons/${r.body.trial.id}`, {
        ...trial,
        startTime: "10:00",
        endTime: "11:00",
        result: "attended",
      })
    ).status,
  ).toBe(200);
  expect((await get("/api/trial-lessons?date=2026-11-02")).body.total).toBe(1);
  expect(
    (
      await patch(
        `/api/trial-lessons/${r.body.trial.id}`,
        { ...trial, result: "cancelled" },
        other,
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await patch(`/api/trial-lessons/${r.body.trial.id}`, {
        ...trial,
        result: "cancelled",
      })
    ).body.trial.result,
  ).toBe("cancelled");
  expect(
    (await post("/api/trial-lessons", { ...trial, endTime: "08:00" })).status,
  ).toBe(400);
  expect(await LessonSession.countDocuments()).toBe(0);
});
it("blocks real schedule overlaps and concurrent trial conflicts while allowing adjacent intervals", async () => {
  const id = await lead();
  const teacher = await User.findOne({ tenantId: tenantA, role: "teacher" });
  const group = await Group.create({
    tenantId: tenantA,
    teacherId: teacher!._id,
    name: "Sinov",
    courseName: "Kurs",
    capacity: 10,
    monthlyFee: 0,
    startDate: new Date(),
  });
  const room = await Classroom.create({
    tenantId: tenantA,
    name: "Xona",
    nameKey: "xona",
  });
  await Schedule.create({
    tenantId: tenantA,
    groupId: group._id,
    teacherId: teacher!._id,
    classroomId: room._id,
    dayOfWeek: 1,
    startTime: "09:00",
    endTime: "10:00",
  });
  const t = {
    leadId: id,
    teacherId: teacher!.id,
    trialDate: "2026-11-02",
    startTime: "09:30",
    endTime: "10:30",
  };
  expect((await post("/api/trial-lessons", t)).status).toBe(409);
  const adjacent = { ...t, startTime: "10:00", endTime: "11:00" };
  const r = await Promise.all([
    post("/api/trial-lessons", adjacent),
    post("/api/trial-lessons", adjacent),
  ]);
  expect(r.map((x) => x.status).sort()).toEqual([201, 409]);
  expect(
    (await get(`/api/trial-lessons?assignedTo=${teacher!.id}`)).body.total,
  ).toBe(1);
});
it("calculates real statistics including archived leads and safe zero denominator", async () => {
  expect((await get("/api/leads/statistics")).body.conversionRate).toBe(0);
  const id = await ready();
  await convert(id);
  await create(owner, { ...input, source: "website", phone: "" });
  await patch(`/api/leads/${id}/archive`, {});
  const stats = await get("/api/leads/statistics");
  expect(stats.body).toMatchObject({
    total: 2,
    converted: 1,
    conversionRate: 50,
    todayNew: 2,
    monthNew: 2,
  });
  expect(stats.body.bySource).toContainEqual({
    _id: "telegram",
    count: 1,
    converted: 1,
  });
  expect((await get("/api/dashboard")).body.leads).toMatchObject({
    total: 2,
    conversionRate: 50,
  });
  expect((await get("/api/dashboard", teacher)).body.leads).toBeUndefined();
  expect((await get("/api/dashboard", platform)).body.leads).toBeUndefined();
});
it("documents rate rounding and strict schemas", () => {
  expect(conversionRate(1, 3)).toBe(33.33);
  expect(conversionRate(0, 0)).toBe(0);
  expect(leadCreate.safeParse({ ...input, tenantId: "x" }).success).toBe(false);
  expect(transitions.converted).toEqual([]);
});
it("rolls back student and lead writes when conversion audit fails", async () => {
  const id = await ready();
  const spy = vi
    .spyOn(LeadHistory, "create")
    .mockRejectedValueOnce(new Error("Synthetic audit failure"));
  try {
    expect((await convert(id)).status).toBe(500);
  } finally {
    spy.mockRestore();
  }
  expect(await Student.countDocuments()).toBe(0);
  const stored = await Lead.findById(id);
  expect(stored!.status).toBe("contacted");
  expect(stored!.convertedStudentId).toBeUndefined();
});
it("keeps name-only leads distinct during conversion and rejects archived student linking", async () => {
  const a = await create(owner, { ...input, phone: "" });
  const b = await create(owner, { ...input, phone: "" });
  for (const r of [a, b]) {
    await patch(`/api/leads/${r.body.lead.id}/status`, { status: "contacted" });
    expect(
      (
        await convert(r.body.lead.id, {
          confirmed: true,
          student: { firstName: "Bir", lastName: "Xil", phone: "" },
        })
      ).status,
    ).toBe(200);
  }
  expect(await Student.countDocuments()).toBe(2);
  const archived = await Student.create({
    ...student,
    tenantId: tenantA,
    createdBy: ownerId,
    status: "archived",
  });
  expect(
    (
      await convert(await ready(), {
        confirmed: true,
        existingStudentId: archived.id,
      })
    ).status,
  ).toBe(404);
});
it("uses Tashkent calendar boundaries for today, upcoming tasks and trial statistics", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-01T20:00:00Z"));
  try {
    const fresh = await actor("business_owner", tenantA);
    owner = fresh.cookie;
    ownerId = fresh.id;
    const id = await lead();
    const body = { leadId: id, assignedTo: String(ownerId), title: "Vazifa" };
    await post("/api/follow-ups", { ...body, dueAt: "2026-11-02T03:00:00Z" });
    await post("/api/follow-ups", { ...body, dueAt: "2026-11-03T03:00:00Z" });
    expect((await get("/api/follow-ups?bucket=today")).body.total).toBe(1);
    expect((await get("/api/follow-ups?bucket=upcoming")).body.total).toBe(1);
    expect((await get("/api/follow-ups?bucket=overdue")).body.total).toBe(0);
    await post("/api/trial-lessons", {
      leadId: id,
      trialDate: "2026-11-02",
      startTime: "10:00",
      endTime: "11:00",
    });
    expect((await get("/api/leads/statistics")).body.todayTrials).toBe(1);
  } finally {
    vi.useRealTimers();
  }
});
it("rejects foreign trial references and detects a lead's own overlapping trials without resources", async () => {
  const id = await lead();
  const t = {
    leadId: id,
    trialDate: "2026-11-02",
    startTime: "10:00",
    endTime: "11:00",
  };
  const foreign = await User.create({
    tenantId: tenantB,
    role: "teacher",
    name: "Test",
    email: "foreign@example.test",
    passwordHash: "unused",
  });
  expect(
    (await post("/api/trial-lessons", { ...t, teacherId: foreign.id })).status,
  ).toBe(404);
  const r = await post("/api/trial-lessons", t);
  expect(r.status).toBe(201);
  expect((await post("/api/trial-lessons", t)).status).toBe(409);
  expect(
    (
      await patch(`/api/trial-lessons/${r.body.trial.id}`, {
        ...t,
        result: "cancelled",
      })
    ).status,
  ).toBe(200);
  expect((await post("/api/trial-lessons", t)).status).toBe(201);
});
