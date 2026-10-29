import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { createApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import { connectDatabase } from "../src/db.js";
import { ensureIndexes, Tenant, User } from "../src/models.js";

const origin = "http://localhost:5173";
const secret = randomBytes(48).toString("hex");
const password = randomBytes(16).toString("hex");
let repl: MongoMemoryReplSet | undefined;
let app: ReturnType<typeof createApp>;
let config: ReturnType<typeof parseConfig>;
function cookie(res: request.Response) {
  return (res.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
}
async function register(email = "owner@a.test", centerName = "Markaz A") {
  return request(app)
    .post("/api/auth/register")
    .set("Origin", origin)
    .send({ name: "Aziz Karimov", email, password, centerName });
}
async function member(
  ownerCookie: string,
  role: "teacher" | "admin",
  email = `${role}@a.test`,
) {
  return request(app)
    .post("/api/team")
    .set("Cookie", ownerCookie)
    .set("Origin", origin)
    .send({ name: "Madina Aliyeva", email, password, role });
}
async function login(email: string) {
  return request(app)
    .post("/api/auth/login")
    .set("Origin", origin)
    .send({ email, password });
}
beforeAll(async () => {
  const external = process.env.TEST_MONGODB_URI;
  // External test targets must explicitly use this dedicated DB; never drop production data.
  if (external && new URL(external).pathname !== "/softlans_edu_test")
    throw new Error("TEST_MONGODB_URI must use /softlans_edu_test");
  if (!external)
    repl = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: "wiredTiger" },
      binary: { version: "7.0.24" },
    });
  const uri = external ?? repl!.getUri("softlans_edu_test");
  config = parseConfig({
    NODE_ENV: "test",
    APP_ORIGIN: origin,
    MONGODB_URI: uri,
    JWT_SECRET: secret,
  });
  await connectDatabase(uri);
  await ensureIndexes();
});
beforeEach(async () => {
  await User.deleteMany({});
  await Tenant.deleteMany({});
  app = createApp(config);
});
afterAll(async () => {
  await mongoose.disconnect();
  await repl?.stop();
});

describe("registration and authentication", () => {
  it("atomically creates an owner and tenant, sets an HTTP-only cookie, and exposes only safe fields", async () => {
    const res = await register();
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe("business_owner");
    expect(res.body.tenant.name).toBe("Markaz A");
    expect(JSON.stringify(res.body)).not.toMatch(
      /password|sessionVersion|token/,
    );
    expect(res.headers["set-cookie"][0]).toMatch(/HttpOnly/);
    expect(res.headers["set-cookie"][0]).toMatch(/SameSite=Strict/);
    const stored = await User.findById(res.body.user.id).select(
      "+passwordHash",
    );
    expect(stored!.tenantId!.toString()).toBe(res.body.tenant.id);
    expect(stored!.passwordHash).not.toBe(password);
    expect(await bcrypt.compare(password, stored!.passwordHash)).toBe(true);
    expect(
      (await request(app).get("/api/auth/me").set("Cookie", cookie(res)))
        .status,
    ).toBe(200);
  });
  it("rolls back the new tenant when owner email conflicts", async () => {
    await register();
    const res = await register("owner@a.test", "Orphan");
    expect(res.status).toBe(409);
    expect(await Tenant.countDocuments()).toBe(1);
    expect(await User.countDocuments()).toBe(1);
  });
  it("resolves concurrent duplicate registration without orphan tenants", async () => {
    const results = await Promise.all([register(), register()]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await Tenant.countDocuments()).toBe(1);
  });
  it("rejects public role escalation and supplied tenant IDs", async () => {
    for (const extra of [
      { role: "super_admin" },
      { role: "admin" },
      { tenantId: new mongoose.Types.ObjectId().toString() },
    ]) {
      const res = await request(app)
        .post("/api/auth/register")
        .set("Origin", origin)
        .send({
          name: "Aziz",
          email: "bad@a.test",
          password,
          centerName: "Bad center",
          ...extra,
        });
      expect(res.status).toBe(400);
    }
    expect(await User.countDocuments()).toBe(0);
    expect(await Tenant.countDocuments()).toBe(0);
  });
  it("normalizes login email and gives the same error for unknown and wrong passwords", async () => {
    await register();
    expect((await login(" OWNER@A.TEST ")).status).toBe(200);
    const missing = await login("absent@a.test");
    const wrong = await request(app)
      .post("/api/auth/login")
      .set("Origin", origin)
      .send({ email: "owner@a.test", password: "wrong-password" });
    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.message).toBe(missing.body.error.message);
  });
  it("rejects missing, forged, expired, and wrong-audience tokens", async () => {
    const owner = await register();
    const payload = { sub: owner.body.user.id, version: 0 };
    const expired = jwt.sign(payload, secret, {
      expiresIn: -1,
      issuer: "softlans-api",
      audience: "softlans-web",
    });
    const wrongAudience = jwt.sign(payload, secret, {
      issuer: "softlans-api",
      audience: "other",
    });
    for (const c of [
      "",
      "softlans_session=forged",
      `softlans_session=${expired}`,
      `softlans_session=${wrongAudience}`,
    ])
      expect(
        (await request(app).get("/api/auth/me").set("Cookie", c)).status,
      ).toBe(401);
  });
  it("revokes copied cookies on logout and clears the cookie", async () => {
    const c = cookie(await register());
    const res = await request(app)
      .post("/api/auth/logout")
      .set("Origin", origin)
      .set("Cookie", c)
      .send({});
    expect(res.status).toBe(204);
    expect(res.headers["set-cookie"][0]).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(
      (await request(app).get("/api/auth/me").set("Cookie", c)).status,
    ).toBe(401);
  });
  it("blocks inactive users and tenants for both existing sessions and new login", async () => {
    const res = await register();
    const c = cookie(res);
    await User.updateOne({ _id: res.body.user.id }, { active: false });
    expect((await login("owner@a.test")).status).toBe(401);
    expect(
      (await request(app).get("/api/auth/me").set("Cookie", c)).status,
    ).toBe(401);
    await User.updateOne({ _id: res.body.user.id }, { active: true });
    await Tenant.updateOne({ _id: res.body.tenant.id }, { active: false });
    expect((await login("owner@a.test")).status).toBe(401);
    expect(
      (await request(app).get("/api/auth/me").set("Cookie", c)).status,
    ).toBe(401);
  });
});
describe("tenant isolation and RBAC", () => {
  it("scopes lists, detail lookups and dashboard counts even with hostile tenant headers or query strings", async () => {
    const a = await register();
    const b = await register("owner@b.test", "Markaz B");
    await member(cookie(a), "teacher");
    await member(cookie(b), "teacher", "teacher@b.test");
    const list = await request(app)
      .get(`/api/team?tenantId=${b.body.tenant.id}`)
      .set("Cookie", cookie(a))
      .set("X-Tenant-ID", b.body.tenant.id);
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(2);
    expect(
      list.body.users.map((u: { email: string }) => u.email).sort(),
    ).toEqual(["owner@a.test", "teacher@a.test"]);
    expect(
      (
        await request(app)
          .get(`/api/team/${b.body.user.id}`)
          .set("Cookie", cookie(a))
      ).status,
    ).toBe(404);
    const dash = await request(app)
      .get(`/api/dashboard?tenantId=${b.body.tenant.id}`)
      .set("Cookie", cookie(a));
    expect(dash.body.teamCount).toBe(2);
    expect(dash.body.teacherCount).toBe(1);
  });
  it("rejects tenant override and privileged fields on member creation", async () => {
    const a = await register();
    const b = await register("b@b.test");
    for (const extra of [
      { tenantId: b.body.tenant.id },
      { role: "super_admin" },
      { role: "business_owner" },
      { sessionVersion: 0 },
    ]) {
      const res = await request(app)
        .post("/api/team")
        .set("Cookie", cookie(a))
        .set("Origin", origin)
        .send({
          name: "Madina",
          email: "member@a.test",
          password,
          role: "teacher",
          ...extra,
        });
      expect(res.status).toBe(400);
    }
    expect(await User.countDocuments()).toBe(2);
  });
  it("allows owners to create admins and teachers, and admins to create only teachers", async () => {
    const c = cookie(await register());
    expect((await member(c, "admin")).status).toBe(201);
    const admin = cookie(await login("admin@a.test"));
    expect((await member(admin, "admin", "admin2@a.test")).status).toBe(403);
    const teacher = await member(admin, "teacher");
    expect(teacher.status).toBe(201);
    expect(teacher.body.user).not.toHaveProperty("passwordHash");
  });
  it("denies teacher access to team routes and limits dashboard disclosure", async () => {
    const c = cookie(await register());
    await member(c, "teacher");
    const teacher = cookie(await login("teacher@a.test"));
    expect(
      (await request(app).get("/api/team").set("Cookie", teacher)).status,
    ).toBe(403);
    expect((await member(teacher, "teacher", "other@a.test")).status).toBe(403);
    const dash = await request(app)
      .get("/api/dashboard")
      .set("Cookie", teacher);
    expect(dash.status).toBe(200);
    expect(dash.body.teamCount).toBeNull();
  });
  it("uses the current database role instead of stale JWT authorization", async () => {
    const owner = await register();
    const c = cookie(owner);
    await User.updateOne({ _id: owner.body.user.id }, { role: "teacher" });
    expect((await request(app).get("/api/team").set("Cookie", c)).status).toBe(
      403,
    );
  });
  it("lets separately provisioned super admins view platform totals without tenant access", async () => {
    await register();
    await register("owner@b.test");
    await User.create({
      name: "Platform operator",
      email: "platform@a.test",
      passwordHash: await bcrypt.hash(password, 12),
      role: "super_admin",
      tenantId: null,
    });
    const c = cookie(await login("platform@a.test"));
    const dash = await request(app).get("/api/dashboard").set("Cookie", c);
    expect(dash.body.scope).toBe("platform");
    expect(dash.body.tenantCount).toBe(2);
    expect(dash.body.teamCount).toBe(2);
    expect((await request(app).get("/api/team").set("Cookie", c)).status).toBe(
      403,
    );
    expect((await member(c, "admin")).status).toBe(403);
  });
});
describe("request hardening", () => {
  it("blocks cross-origin and originless writes, including login CSRF", async () => {
    for (const value of ["", "https://evil.example"])
      expect(
        (
          await request(app)
            .post("/api/auth/login")
            .set("Origin", value)
            .send({ email: "owner@a.test", password })
        ).status,
      ).toBe(403);
    expect(
      (
        await request(app)
          .post("/api/auth/login")
          .set("Origin", origin)
          .type("form")
          .send({ email: "a@b.test" })
      ).status,
    ).toBe(415);
  });
  it("rejects NoSQL injection, malformed JSON and oversized bodies without leaking internals", async () => {
    const injected = await request(app)
      .post("/api/auth/login")
      .set("Origin", origin)
      .send({ email: { $ne: null }, password });
    expect(injected.status).toBe(400);
    const malformed = await request(app)
      .post("/api/auth/login")
      .set("Origin", origin)
      .set("Content-Type", "application/json")
      .send("{");
    expect(malformed.status).toBe(400);
    const large = await request(app)
      .post("/api/auth/login")
      .set("Origin", origin)
      .send({ email: "a@b.test", password: "x".repeat(17000) });
    expect(large.status).toBe(413);
    for (const res of [injected, malformed, large]) {
      expect(res.body.error.requestId).toBeTruthy();
      expect(res.body.error).not.toHaveProperty("stack");
    }
  });
  it("rate limits login and registration attempts with structured errors", async () => {
    for (let n = 0; n < 15; n++)
      expect(
        (
          await request(app)
            .post("/api/auth/login")
            .set("Origin", origin)
            .send({})
        ).status,
      ).toBe(400);
    const blocked = await request(app)
      .post("/api/auth/login")
      .set("Origin", origin)
      .send({});
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("RATE_LIMITED");
    expect(blocked.headers["retry-after"]).toBeTruthy();
    for (let n = 0; n < 5; n++)
      expect(
        (
          await request(app)
            .post("/api/auth/register")
            .set("Origin", origin)
            .send({})
        ).status,
      ).toBe(400);
    expect(
      (
        await request(app)
          .post("/api/auth/register")
          .set("Origin", origin)
          .send({})
      ).status,
    ).toBe(429);
  });
  it("sends security headers, no-store, bounded pagination and safe 404 responses", async () => {
    const c = cookie(await register());
    const res = await request(app).get("/api/team?page=-1").set("Cookie", c);
    expect(res.status).toBe(400);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect((await request(app).get("/api/unknown")).status).toBe(404);
  });
});

describe("public demo deployment", () => {
  const demoOrigin = "https://softlans-demo.example.test";
  it("closes signup without creating data and preserves HTTPS cookie login, tenants and roles", async () => {
    const owner = await register();
    const other = await register("owner@b.test", "Markaz B");
    await member(cookie(owner), "teacher");
    app = createApp(
      parseConfig({
        NODE_ENV: "production",
        APP_ORIGIN: demoOrigin,
        MONGODB_URI: config.MONGODB_URI,
        JWT_SECRET: secret,
        TRUST_PROXY_HOPS: "1",
        DEMO_MODE: "true",
        PUBLIC_REGISTRATION_ENABLED: "false",
      }),
    );
    const blocked = await request(app)
      .post("/api/auth/register")
      .set("Origin", demoOrigin)
      .send({
        name: "Test Owner", email: "closed@a.test", password, centerName: "Closed",
      });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("REGISTRATION_DISABLED");
    expect(await Tenant.countDocuments()).toBe(2);
    expect(await User.countDocuments()).toBe(3);

    const signedIn = await request(app)
      .post("/api/auth/login")
      .set("Origin", demoOrigin)
      .set("X-Forwarded-Proto", "https")
      .send({ email: "owner@a.test", password });
    expect(signedIn.status).toBe(200);
    const sessionCookie = signedIn.headers["set-cookie"][0] as string;
    expect(sessionCookie).toMatch(/; Secure/);
    expect(sessionCookie).toMatch(/; HttpOnly/);
    expect(sessionCookie).toMatch(/; SameSite=Strict/);
    expect(sessionCookie).toMatch(/; Path=\/api/);
    expect(sessionCookie).not.toMatch(/Domain=/i);
    const team = await request(app)
      .get("/api/team")
      .set("Cookie", cookie(signedIn));
    expect(team.status).toBe(200);
    expect(team.body.total).toBe(2);
    const foreign = await request(app)
      .get(`/api/team/${other.body.user.id}`)
      .set("Cookie", cookie(signedIn));
    expect(foreign.status).toBe(404);
    const teacher = await request(app)
      .post("/api/auth/login")
      .set("Origin", demoOrigin)
      .send({ email: "teacher@a.test", password });
    const denied = await request(app)
      .get("/api/team")
      .set("Cookie", cookie(teacher));
    expect(denied.status).toBe(403);
    expect((await request(app).get("/api/ready")).body).toEqual({
      ready: true,
    });
  });
  it("supports explicitly enabling demo registration with a real transaction", async () => {
    app = createApp(
      parseConfig({
        NODE_ENV: "test",
        APP_ORIGIN: origin,
        MONGODB_URI: config.MONGODB_URI,
        JWT_SECRET: secret,
        DEMO_MODE: "true",
        PUBLIC_REGISTRATION_ENABLED: "true",
      }),
    );
    expect((await register()).status).toBe(201);
    expect(await User.countDocuments()).toBe(1);
    expect(await Tenant.countDocuments()).toBe(1);
  });
});
