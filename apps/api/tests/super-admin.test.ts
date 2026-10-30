import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { createApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import { connectDatabase } from "../src/db.js";
import { ensureIndexes, Student, Tenant, User } from "../src/models.js";
import { PlatformAudit } from "../src/super-admin-models.js";

const origin = "http://localhost:5173";
const secret = randomBytes(48).toString("hex");
const password = randomBytes(18).toString("hex");
const base = "/api/super-admin";
let repl: MongoMemoryReplSet;
let config: ReturnType<typeof parseConfig>;
let app: ReturnType<typeof createApp>;
let passwordHash: string;
let tenantA: mongoose.Types.ObjectId;
let tenantB: mongoose.Types.ObjectId;
let ownerId: mongoose.Types.ObjectId;
let platformId: mongoose.Types.ObjectId;
let owner: string;
let other: string;
let admin: string;
let teacher: string;
let platform: string;

function token(id: mongoose.Types.ObjectId, extra: object = {}, version = 0) {
  return `softlans_session=${jwt.sign({ version, ...extra }, secret, {
    subject: id.toString(),
    expiresIn: "1h",
    issuer: "softlans-api",
    audience: "softlans-web",
  })}`;
}
async function actor(role: "business_owner" | "admin" | "teacher" | "super_admin", tenantId: mongoose.Types.ObjectId | null, email: string) {
  const user = await User.create({ role, tenantId, email, name: "Sinov hisobi", passwordHash });
  return { id: user._id, cookie: token(user._id) };
}
const get = (path: string, cookie = platform) => request(app).get(path).set("Cookie", cookie);
const post = (path: string, body: object, cookie = platform) => request(app).post(path).set("Cookie", cookie).set("Origin", origin).send(body);
const block = (revision = 0, cookie = platform) => post(`${base}/tenants/${tenantA}/block`, { reason: "Shartlarni tekshirish", expectedRevision: revision }, cookie);
const activate = (revision = 1) => post(`${base}/tenants/${tenantA}/activate`, { reason: "Tekshiruv yakunlandi", expectedRevision: revision });
const login = (email: string) => post("/api/auth/login", { email, password });
async function student(tenantId = tenantA, createdBy = ownerId, status = "active") {
  return Student.create({ tenantId, createdBy, firstName: "Maxfiy", lastName: "O‘quvchi", parentName: "Maxfiy Otaona", phone: "+998901234567", notes: "Maxfiy izoh", status });
}

beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: "7.0.24" } });
  const uri = repl.getUri("softlans_super_admin_test");
  config = parseConfig({ NODE_ENV: "test", APP_ORIGIN: origin, MONGODB_URI: uri, JWT_SECRET: secret });
  passwordHash = await bcrypt.hash(password, 4);
  await connectDatabase(uri);
  await ensureIndexes();
});
beforeEach(async () => {
  vi.restoreAllMocks();
  await Promise.all([Student.deleteMany({}), User.deleteMany({}), Tenant.deleteMany({}), PlatformAudit.collection.deleteMany({})]);
  tenantA = (await Tenant.create({ name: "Alfa [.+] markazi" }))._id;
  tenantB = (await Tenant.create({ name: "Beta markazi" }))._id;
  const a = await actor("business_owner", tenantA, "owner@a.test");
  ownerId = a.id;
  owner = a.cookie;
  other = (await actor("business_owner", tenantB, "owner@b.test")).cookie;
  admin = (await actor("admin", tenantA, "admin@a.test")).cookie;
  teacher = (await actor("teacher", tenantA, "teacher@a.test")).cookie;
  const p = await actor("super_admin", null, "platform@a.test");
  platformId = p.id;
  platform = p.cookie;
  app = createApp(config);
});
afterAll(async () => { vi.restoreAllMocks(); await mongoose.disconnect(); await repl?.stop(); });

describe("platform statistics and tenant views", () => {
  it("counts persisted tenants, all users and students, including archived records, without returning private records", async () => {
    await Tenant.updateOne({ _id: tenantB }, { active: false });
    const recent = await Tenant.create({ name: "Yaqinda" });
    const old = await Tenant.create({ name: "Eski" });
    const now = Date.now();
    await Tenant.collection.updateOne({ _id: recent._id }, { $set: { createdAt: new Date(now - 10 * 86400000) } });
    await Tenant.collection.updateOne({ _id: old._id }, { $set: { createdAt: new Date(now - 40 * 86400000) } });
    await student();
    await student(tenantA, ownerId, "archived");
    await student(tenantB);
    const res = await get(`${base}/stats`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ totalTenants: 4, activeTenants: 3, blockedTenants: 1, todayTenants: 2, last30DaysTenants: 3, totalStudents: 3, totalUsers: 5, timezone: "Asia/Tashkent" });
    expect(res.body.growth).toHaveLength(30);
    expect(res.body.growth.reduce((sum: number, point: { count: number }) => sum + point.count, 0)).toBe(3);
    expect(new Date(res.body.generatedAt).getTime()).toBeGreaterThan(now - 1000);
    expect(JSON.stringify(res.body)).not.toMatch(/Maxfiy|parentName|phone|password|sessionVersion|payment/);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("uses Tashkent calendar boundaries for today's registrations", async () => {
    const localDay = new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 10);
    const start = new Date(`${localDay}T00:00:00+05:00`).getTime();
    await Tenant.collection.updateOne({ _id: tenantA }, { $set: { createdAt: new Date(start - 1) } });
    await Tenant.collection.updateOne({ _id: tenantB }, { $set: { createdAt: new Date(start) } });
    const res = await get(`${base}/stats`);
    expect(res.status).toBe(200);
    expect(res.body.todayTenants).toBe(1);
  });

  it("searches literal names, filters by status, and paginates deterministically", async () => {
    await Tenant.updateOne({ _id: tenantB }, { active: false });
    await Tenant.insertMany(Array.from({ length: 23 }, (_, n) => ({ name: `Markaz ${n}` })));
    const first = await get(`${base}/tenants?page=1`);
    const second = await get(`${base}/tenants?page=2`);
    expect(first.status).toBe(200);
    expect(first.body.total).toBe(25);
    expect(first.body.tenants).toHaveLength(first.body.pageSize);
    expect(second.body.tenants).toHaveLength(25 - first.body.pageSize);
    const firstIds = new Set(first.body.tenants.map((t: { id: string }) => t.id));
    expect(second.body.tenants.every((t: { id: string }) => !firstIds.has(t.id))).toBe(true);
    expect((await get(`${base}/tenants?search=${encodeURIComponent("[.+]")}`)).body.total).toBe(1);
    expect((await get(`${base}/tenants?search=alfa`)).body.tenants[0].id).toBe(tenantA.toString());
    expect((await get(`${base}/tenants?status=blocked`)).body.tenants.map((t: { id: string }) => t.id)).toEqual([tenantB.toString()]);
    expect((await get(`${base}/tenants?status=active`)).body.total).toBe(24);
    expect((await get(`${base}/tenants?search=mavjud-emas`)).body).toMatchObject({ tenants: [], total: 0 });
  });

  it("returns aggregate counts and minimal owner fields, and reports unavailable activity honestly", async () => {
    await student();
    await student(tenantB);
    const res = await get(`${base}/tenants/${tenantA}`);
    expect(res.status).toBe(200);
    expect(res.body.tenant).toMatchObject({ id: tenantA.toString(), name: "Alfa [.+] markazi", status: "active", userCount: 3, studentCount: 1, statusRevision: 0, lastActivityAt: null });
    expect(new Date(res.body.tenant.createdAt).getTime()).not.toBeNaN();
    expect(res.body.owner).toEqual({ id: ownerId.toString(), name: "Sinov hisobi", email: "owner@a.test" });
    expect(JSON.stringify(res.body)).not.toMatch(/Maxfiy|password|sessionVersion|parentName|phone|notes|payment/);
    await User.deleteOne({ _id: ownerId });
    expect((await get(`${base}/tenants/${tenantA}`)).body.owner).toBeNull();
    expect((await get(`${base}/tenants/${new mongoose.Types.ObjectId()}`)).status).toBe(404);
    expect((await get(`${base}/tenants/not-an-id`)).status).toBe(404);
  });

  it("rejects malformed and unbounded list/audit queries", async () => {
    for (const query of ["page=0", "page=1.5", "page=10001", "page[]=1", "status=deleted", "search=" + "x".repeat(121)]) {
      expect((await get(`${base}/tenants?${query}`)).status, query).toBe(400);
    }
    expect((await get(`${base}/audit?page=0`)).status).toBe(400);
    expect((await get(`${base}/audit?tenantId=invalid`)).status).toBe(400);
  });
});

describe("transactional tenant status and audit", () => {
  it("blocks existing sessions and logins, preserves data, and requires a fresh login after activation", async () => {
    const storedStudent = await student();
    const blocked = await block();
    expect(blocked.status).toBe(200);
    expect(blocked.body.tenant).toMatchObject({ id: tenantA.toString(), status: "blocked", statusRevision: 1 });
    for (const c of [owner, admin, teacher]) {
      expect((await get("/api/auth/me", c)).status).toBe(401);
      expect((await get("/api/students", c)).status).toBe(401);
      expect((await post("/api/team", { name: "Yangi", email: "new@a.test", password, role: "teacher" }, c)).status).toBe(401);
    }
    expect((await login("owner@a.test")).status).toBe(401);
    expect((await get("/api/auth/me", other)).status).toBe(200);
    expect((await get(`${base}/stats`)).status).toBe(200);
    expect(await Student.exists({ _id: storedStudent._id })).not.toBeNull();
    expect(await User.countDocuments({ tenantId: tenantA })).toBe(3);
    const active = await activate();
    expect(active.status).toBe(200);
    expect(active.body.tenant).toMatchObject({ status: "active", statusRevision: 2 });
    expect((await get("/api/auth/me", owner)).status).toBe(401);
    const fresh = await login("owner@a.test");
    expect(fresh.status).toBe(200);
    expect((await get("/api/auth/me", fresh.headers["set-cookie"][0].split(";")[0])).status).toBe(200);
  });

  it("records exactly the actor, target, reason, time, previous/new status and revision", async () => {
    expect((await block()).status).toBe(200);
    expect((await activate()).status).toBe(200);
    const res = await get(`${base}/audit?tenantId=${tenantA}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.entries[0]).toMatchObject({ actorId: platformId.toString(), tenantId: tenantA.toString(), action: "activate", reason: "Tekshiruv yakunlandi", previousStatus: "blocked", newStatus: "active", revision: 2 });
    expect(res.body.entries[1]).toMatchObject({ action: "block", reason: "Shartlarni tekshirish", previousStatus: "active", newStatus: "blocked", revision: 1 });
    expect(Object.keys(res.body.entries[0]).sort()).toEqual(["id", "actorId", "tenantId", "action", "reason", "createdAt", "previousStatus", "newStatus", "revision"].sort());
    expect(new Date(res.body.entries[0].createdAt).getTime()).not.toBeNaN();
    expect((await get(`${base}/audit?tenantId=${tenantB}`)).body.total).toBe(0);
    expect(JSON.stringify(res.body)).not.toMatch(/email|password|token|sessionVersion/);
  });

  it("rejects repeats and stale ABA operations without creating misleading audit entries", async () => {
    expect((await block()).status).toBe(200);
    expect((await block()).status).toBe(409);
    expect((await block(1)).status).toBe(409);
    expect((await activate()).status).toBe(200);
    expect((await block()).status).toBe(409);
    expect((await activate(2)).status).toBe(409);
    expect(await PlatformAudit.countDocuments({ tenantId: tenantA })).toBe(2);
    expect((await get(`${base}/tenants/${tenantA}`)).body.tenant).toMatchObject({ status: "active", statusRevision: 2 });
  });

  it("serializes simultaneous block requests and prevents competing stale block/unblock writes", async () => {
    const repeated = await Promise.all([block(), block(), block()]);
    expect(repeated.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect(await PlatformAudit.countDocuments({ tenantId: tenantA })).toBe(1);
    const opposite = await Promise.all([activate(1), block(1)]);
    expect(opposite.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await PlatformAudit.countDocuments({ tenantId: tenantA })).toBe(2);
    expect((await User.findById(ownerId).select("+sessionVersion"))!.sessionVersion).toBe(1);
    expect((await get(`${base}/tenants/${tenantA}`)).body.tenant).toMatchObject({ status: "active", statusRevision: 2 });
  });

  it("rolls back status and session invalidation if the audit insert fails", async () => {
    const spy = vi.spyOn(PlatformAudit, "create").mockRejectedValueOnce(new Error("synthetic audit failure"));
    const res = await block();
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect((await Tenant.findById(tenantA))!.active).toBe(true);
    expect((await User.findById(ownerId).select("+sessionVersion"))!.sessionVersion).toBe(0);
    expect(await PlatformAudit.countDocuments()).toBe(0);
    expect((await get("/api/auth/me", owner)).status).toBe(200);
  });

  it("rejects recognizable secrets/contact details and keeps audit records append-only", async () => {
    for (const reason of ["token=private-secret", "parol: private-password", "user@example.test", "+998901234567", "Yangi\nqator"]) {
      expect((await post(`${base}/tenants/${tenantA}/block`, { reason, expectedRevision: 0 })).status).toBe(400);
    }
    expect(await PlatformAudit.countDocuments()).toBe(0);
    expect((await block()).status).toBe(200);
    const entry = await PlatformAudit.findOne();
    await expect(PlatformAudit.updateOne({ _id: entry!._id }, { reason: "O‘zgardi" })).rejects.toThrow(/append-only/);
    await expect(PlatformAudit.deleteOne({ _id: entry!._id })).rejects.toThrow(/append-only/);
    await expect(entry!.save()).rejects.toThrow(/append-only/);
    expect((await PlatformAudit.findById(entry!._id))!.reason).toBe("Shartlarni tekshirish");
  });

  it("supports existing tenants without a stored revision and validates status commands", async () => {
    await Tenant.collection.updateOne({ _id: tenantA }, { $unset: { statusRevision: "" } });
    expect((await get(`${base}/tenants/${tenantA}`)).body.tenant.statusRevision).toBe(0);
    for (const body of [ {}, { reason: "  ", expectedRevision: 0 }, { reason: "x".repeat(301), expectedRevision: 0 }, { reason: "Sabab", expectedRevision: -1 }, { reason: "Sabab", expectedRevision: 0, active: false } ]) {
      expect((await post(`${base}/tenants/${tenantA}/block`, body)).status).toBe(400);
    }
    expect((await block()).status).toBe(200);
    expect((await post(`${base}/tenants/${new mongoose.Types.ObjectId()}/block`, { reason: "Sabab", expectedRevision: 0 })).status).toBe(404);
  });
});

describe("server RBAC and isolation", () => {
  it("denies all platform endpoints for every tenant role and unauthenticated sessions", async () => {
    for (const cookie of [owner, admin, teacher, other, ""]) {
      const expected = cookie ? 403 : 401;
      for (const path of [`${base}/stats`, `${base}/tenants`, `${base}/tenants/${tenantA}`, `${base}/audit`]) {
        expect((await get(path, cookie)).status).toBe(expected);
      }
      expect((await block(0, cookie)).status).toBe(expected);
      expect((await post(`${base}/tenants/${tenantA}/activate`, { reason: "Sabab", expectedRevision: 0 }, cookie)).status).toBe(expected);
    }
    expect(await PlatformAudit.countDocuments()).toBe(0);
    expect((await Tenant.findById(tenantA))!.active).toBe(true);
  });

  it("uses the database role, not client JWT/header/query role declarations", async () => {
    const forgedRole = token(ownerId, { role: "super_admin", tenantId: null });
    expect((await get(`${base}/stats?role=super_admin`, forgedRole).set("X-Role", "super_admin")).status).toBe(403);
    await User.updateOne({ _id: platformId }, { active: false });
    expect((await get(`${base}/stats`)).status).toBe(401);
  });

  it("authenticates provisioned platform users but prevents public super-admin creation and malformed platform scope", async () => {
    const res = await login("platform@a.test");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ user: { role: "super_admin" }, tenant: null });
    expect(JSON.stringify(res.body)).not.toMatch(/password|sessionVersion|token/);
    expect((await post("/api/auth/register", { name: "Platform", email: "new@a.test", password, centerName: "Markaz", role: "super_admin" })).status).toBe(400);
    // Bypass schema only to simulate a corrupted/legacy account: authentication must fail closed.
    await User.collection.updateOne({ _id: platformId }, { $set: { tenantId: tenantA } });
    expect((await login("platform@a.test")).status).toBe(401);
    expect((await get(`${base}/stats`)).status).toBe(401);
    expect((await block()).status).toBe(401);
    expect((await Tenant.findById(tenantA))!.active).toBe(true);
  });

  it("cannot block the platform account as if it were a tenant or expose tenant students/payments/team", async () => {
    expect((await post(`${base}/tenants/${platformId}/block`, { reason: "Sabab", expectedRevision: 0 })).status).toBe(404);
    expect((await get("/api/auth/me")).status).toBe(200);
    const s = await student();
    for (const path of ["/api/students", `/api/students/${s._id}`, "/api/team", "/api/billing/payments", "/api/debts"]) {
      expect((await get(path)).status, path).toBe(403);
    }
    expect((await get(`/api/students/${s._id}`, other)).status).toBe(404);
    expect((await get(`${base}/stats?tenantId=${tenantB}`, owner)).status).toBe(403);
  });

  it("protects a tenant accidentally linked to another platform administrator", async () => {
    const corrupted = await actor("super_admin", null, "legacy-platform@a.test");
    await User.collection.updateOne({ _id: corrupted.id }, { $set: { tenantId: tenantA } });
    const res = await block();
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PROTECTED_TENANT");
    expect((await Tenant.findById(tenantA))!.active).toBe(true);
    expect(await PlatformAudit.countDocuments()).toBe(0);
  });

  it("limits platform statistics requests per authenticated administrator", async () => {
    for (let i = 0; i < 60; i++) {
      expect((await get(`${base}/stats`)).status).toBe(200);
    }
    const denied = await get(`${base}/stats`);
    expect(denied.status).toBe(429);
    expect(denied.body.error.code).toBe("RATE_LIMITED");
    const second = await actor("super_admin", null, "second-platform@a.test");
    expect((await get(`${base}/stats`, second.cookie)).status).toBe(200);
  });

  it("enforces CSRF origin and prevents audit edits through the API", async () => {
    const payload = { reason: "Sabab", expectedRevision: 0 };
    expect((await request(app).post(`${base}/tenants/${tenantA}/block`).set("Cookie", platform).send(payload)).status).toBe(403);
    expect((await request(app).post(`${base}/tenants/${tenantA}/block`).set("Cookie", platform).set("Origin", "https://other.test").send(payload)).status).toBe(403);
    expect((await block()).status).toBe(200);
    const entry = await PlatformAudit.findOne();
    for (const cookie of [owner, platform]) {
      const edit = await request(app).patch(`${base}/audit/${entry!._id}`).set("Cookie", cookie).set("Origin", origin).send({ reason: "Changed" });
      expect([401, 403, 404]).toContain(edit.status);
    }
    expect((await PlatformAudit.findById(entry!._id))!.reason).toBe("Shartlarni tekshirish");
  });
});
