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
import { studentCreateSchema } from "../src/student-validation.js";

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
  firstName: "Sinov",
  lastName: "O‘quvchi",
  phone: "+000 (000) 00-01",
  parentName: "Sinov vakili",
  parentPhone: "+0000000002",
  notes: "Faqat sun’iy sinov ma’lumotlari",
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
    .post("/api/students")
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

describe("student lifecycle and validation", () => {
  it("creates normalized records with authenticated tenant, creator, defaults and safe serialization", async () => {
    const res = await create(owner, {
      ...input,
      firstName: "  Sinov   Ismi  ",
      birthDate: "2010-01-01",
    });
    expect(res.status).toBe(201);
    expect(res.body.student).toMatchObject({
      firstName: "Sinov Ismi",
      phone: "+0000000001",
      status: "active",
      createdBy: ownerId.toString(),
      birthDate: "2010-01-01",
    });
    expect(res.body.student).not.toHaveProperty("tenantId");
    expect(res.body.student.createdAt).toBeTruthy();
    const stored = await Student.findOne({
      _id: res.body.student.id,
      tenantId: tenantA,
    });
    expect(stored).toBeTruthy();
  });
  it("supports listing, full-name and normalized phone search, status filtering and deterministic date sorting", async () => {
    await create(owner, { ...input, enrollmentDate: "2020-01-01" });
    const newest = await create(owner, {
      ...input,
      firstName: "Yangi",
      enrollmentDate: "2021-01-01",
      status: "paused",
    });
    await create(other);
    const list = await request(app)
      .get("/api/students?page=1&pageSize=1")
      .set("Cookie", owner);
    expect(list.body).toMatchObject({ total: 2, page: 1, pageSize: 1 });
    expect(list.body.students[0].id).toBe(newest.body.student.id);
    const next = await request(app)
      .get("/api/students?page=2&pageSize=1")
      .set("Cookie", owner);
    expect(next.body.students[0].firstName).toBe("Sinov");
    for (const search of ["sinov o‘quvchi", "+000 (000) 00-01"]) {
      const r = await request(app)
        .get("/api/students")
        .query({ search })
        .set("Cookie", owner);
      expect(r.status).toBe(200);
      expect(r.body.total).toBe(search.startsWith("+") ? 2 : 1);
    }
    const paused = await request(app)
      .get("/api/students?status=paused&sort=asc")
      .set("Cookie", owner);
    expect(paused.body.total).toBe(1);
    const literal = await request(app)
      .get("/api/students")
      .query({ search: ".*" })
      .set("Cookie", owner);
    expect(literal.body.total).toBe(0);
    const empty = await request(app)
      .get("/api/students?page=99")
      .set("Cookie", owner);
    expect(empty.body.students).toEqual([]);
  });
  it("edits only allowed fields, clears optional data and archives without deleting", async () => {
    const id = (await create()).body.student.id;
    const update = await patch(`/api/students/${id}`, {
      firstName: "Yangilangan",
      phone: "",
      birthDate: null,
      notes: "",
    });
    expect(update.status).toBe(200);
    expect(update.body.student).toMatchObject({
      firstName: "Yangilangan",
      phone: "",
      birthDate: null,
      notes: "",
    });
    for (const status of ["paused", "archived", "active"]) {
      const res = await patch(`/api/students/${id}/status`, { status });
      expect(res.status).toBe(200);
      expect(res.body.student.status).toBe(status);
    }
    expect(await Student.countDocuments({ tenantId: tenantA })).toBe(1);
    expect(
      (
        await request(app)
          .delete(`/api/students/${id}`)
          .set("Cookie", owner)
          .set("Origin", origin)
          .send({})
      ).status,
    ).toBe(404);
  });
  it.each([
    { firstName: "" },
    { firstName: "<script>" },
    { firstName: "a".repeat(101) },
    { phone: "abc" },
    { phone: "1".repeat(16) },
    { birthDate: "2025-02-30" },
    { birthDate: "2999-01-01" },
    { enrollmentDate: null },
    { notes: "x".repeat(2001) },
    { tenantId: new mongoose.Types.ObjectId().toString() },
    { createdBy: new mongoose.Types.ObjectId().toString() },
    { status: "deleted" },
    { firstName: { $ne: null } },
    { $set: { firstName: "Injected" } },
  ])("rejects invalid or privileged create input %#", async (extra) => {
    expect((await create(owner, { ...input, ...extra })).status).toBe(400);
    expect(await Student.countDocuments({ tenantId: tenantA })).toBe(0);
  });
  it("rejects empty, privileged and status-mixed patches and invalid pagination/query objects", async () => {
    const id = (await create()).body.student.id;
    for (const body of [
      {},
      { tenantId: tenantB.toString() },
      { createdBy: ownerId.toString() },
      { status: "archived" },
      { firstName: { $gt: "" } },
    ])
      expect((await patch(`/api/students/${id}`, body)).status).toBe(400);
    expect(
      (
        await patch(`/api/students/${id}/status`, {
          status: "archived",
          notes: "extra",
        })
      ).status,
    ).toBe(400);
    for (const query of [
      "page=0",
      "page=1.5",
      "page=10001",
      "pageSize=101",
      "status=deleted",
      "sort=wrong",
      "search[$ne]=x",
      "search=a&search=b",
      `tenantId=${tenantB}`,
    ])
      expect(
        (await request(app).get(`/api/students?${query}`).set("Cookie", owner))
          .status,
      ).toBe(400);
    expect(
      studentCreateSchema.safeParse({ ...input, notes: "\u0000" }).success,
    ).toBe(false);
  });
});
describe("student access boundaries", () => {
  it("allows owners and admins for every student operation", async () => {
    for (const c of [owner, admin]) {
      const made = await create(c);
      expect(made.status).toBe(201);
      const id = made.body.student.id;
      expect(
        (await request(app).get("/api/students").set("Cookie", c)).status,
      ).toBe(200);
      expect(
        (await request(app).get(`/api/students/${id}`).set("Cookie", c)).status,
      ).toBe(200);
      expect(
        (await patch(`/api/students/${id}`, { notes: "Sun’iy izoh" }, c))
          .status,
      ).toBe(200);
      expect(
        (await patch(`/api/students/${id}/status`, { status: "archived" }, c))
          .status,
      ).toBe(200);
    }
  });
  it("denies teachers, platform admins and unauthenticated requests on all five endpoints", async () => {
    const id = (await create()).body.student.id;
    for (const c of [teacher, platform, ""]) {
      const expected = c ? 403 : 401;
      expect((await create(c)).status).toBe(expected);
      expect(
        (await request(app).get("/api/students").set("Cookie", c)).status,
      ).toBe(expected);
      expect(
        (await request(app).get(`/api/students/${id}`).set("Cookie", c)).status,
      ).toBe(expected);
      expect(
        (await patch(`/api/students/${id}`, { notes: "x" }, c)).status,
      ).toBe(expected);
      expect(
        (await patch(`/api/students/${id}/status`, { status: "archived" }, c))
          .status,
      ).toBe(expected);
      if (c)
        expect(
          (await request(app).get("/api/dashboard").set("Cookie", c)).body,
        ).not.toHaveProperty("students");
    }
  });
  it("prevents IDOR on detail and both updates and ignores hostile headers", async () => {
    const id = (await create(other)).body.student.id;
    const list = await request(app)
      .get("/api/students")
      .set("Cookie", owner)
      .set("X-Tenant-ID", tenantB.toString());
    expect(list.body.total).toBe(0);
    for (const target of [
      id,
      new mongoose.Types.ObjectId().toString(),
      "invalid-id",
    ]) {
      const detail = await request(app)
        .get(`/api/students/${target}`)
        .set("Cookie", owner);
      expect(detail.status).toBe(404);
      expect(
        (await patch(`/api/students/${target}`, { notes: "changed" })).status,
      ).toBe(404);
      expect(
        (await patch(`/api/students/${target}/status`, { status: "archived" }))
          .status,
      ).toBe(404);
    }
    const unchanged = await Student.findOne({ _id: id, tenantId: tenantB });
    expect(unchanged?.status).toBe("active");
    expect(unchanged?.notes).toBe(input.notes);
  });
  it("preserves origin, JSON requirements, no-store and safe errors without logging PII", async () => {
    const spy = vi.spyOn(console, "error");
    const id = (await create()).body.student.id;
    for (const badOrigin of ["", "https://evil.example"]) {
      expect(
        (
          await request(app)
            .post("/api/students")
            .set("Cookie", owner)
            .set("Origin", badOrigin)
            .send(input)
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .patch(`/api/students/${id}`)
            .set("Cookie", owner)
            .set("Origin", badOrigin)
            .send(input)
        ).status,
      ).toBe(403);
    }
    expect(
      (
        await request(app)
          .patch(`/api/students/${id}`)
          .set("Cookie", owner)
          .set("Origin", origin)
          .type("form")
          .send({ notes: "x" })
      ).status,
    ).toBe(415);
    const res = await create(owner, {
      ...input,
      phone: "sensitive-invalid-number",
    });
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.error.requestId).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toContain("sensitive-invalid-number");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
  it("computes tenant statistics from stored enrollment dates and statuses", async () => {
    await create(owner, { ...input, enrollmentDate: "2020-01-01" });
    await create(owner, { ...input, status: "paused" });
    const archived = await create(owner, { ...input, status: "archived" });
    await create(other);
    const res = await request(app)
      .get("/api/dashboard")
      .set("Cookie", owner)
      .query({ tenantId: tenantB.toString() });
    expect(res.body.students).toEqual({
      total: 3,
      active: 1,
      paused: 1,
      recent: 2,
    });
    await patch(`/api/students/${archived.body.student.id}/status`, {
      status: "active",
    });
    const updated = await request(app)
      .get("/api/dashboard")
      .set("Cookie", admin);
    expect(updated.body.students).toEqual({
      total: 3,
      active: 2,
      paused: 1,
      recent: 2,
    });
  });
});
