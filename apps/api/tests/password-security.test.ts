import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import request from "supertest";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import { connectDatabase } from "../src/db.js";
import { ensureIndexes, Tenant, User } from "../src/models.js";
import { createSession } from "../src/security.js";
import { hashResetToken, recoveryMessage } from "../src/password-security.js";
import { configuredPasswordEmail, resetUrl } from "../src/password-email.js";
import { TestPasswordEmail } from "./helpers/password-email.js";

const origin = "http://localhost:5173";
const secret = randomBytes(48).toString("hex");
const password = "Disposable-current-password!";
const newPassword = "Disposable-new-password!";
let repl: MongoMemoryReplSet;
let config: ReturnType<typeof parseConfig>;
let app: ReturnType<typeof createApp>;
let mailbox: TestPasswordEmail;
let actor: Awaited<ReturnType<typeof User.create>>;
let tenant: Awaited<ReturnType<typeof Tenant.create>>;
let hash: string;
let cookie: string;
const post = (path: string, body: unknown) => request(app).post(`/api/auth/${path}`).set("Origin", origin).send(body);
const change = (body: unknown = { currentPassword: password, newPassword }) => post("change-password", body).set("Cookie", cookie);
const reset = (token: string, next = newPassword) => post("reset-password", { token, newPassword: next });
async function recover() {
  const before = mailbox.messages.length;
  const res = await post("forgot-password", { email: actor.email });
  expect(res.status).toBe(202);
  await vi.waitFor(() => expect(mailbox.messages.length).toBe(before + 1));
  return mailbox.token();
}
async function refresh() {
  app = createApp(config, { testPasswordEmail: mailbox });
  cookie = `softlans_session=${await createSession(actor as any, config)}`;
}
beforeAll(async () => {
  // Always allocate a fresh local replica set. No external or production URI accepted.
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: "7.0.24" } });
  config = parseConfig({ NODE_ENV: "test", MONGODB_URI: repl.getUri("password_security_disposable"), APP_ORIGIN: origin, JWT_SECRET: secret });
  await connectDatabase(config.MONGODB_URI);
  await ensureIndexes();
  hash = await bcrypt.hash(password, 12);
});
beforeEach(async () => {
  await User.deleteMany({}); await Tenant.deleteMany({});
  tenant = await Tenant.create({ name: "Sinov markazi" });
  actor = await User.create({ name: "Sinov", email: "owner@password.test", role: "business_owner", tenantId: tenant._id, passwordHash: hash });
  mailbox = new TestPasswordEmail(); await refresh();
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => { await mongoose.disconnect(); await repl?.stop(); });

describe("authenticated change", () => {
  it("verifies current password, atomically revokes all sessions, preserves role/tenant and clears cookie", async () => {
    const token = await recover();
    const res = await change();
    expect(res.status).toBe(204);
    expect(res.headers["set-cookie"][0]).toMatch(/Expires=Thu, 01 Jan 1970/);
    const stored = await User.findById(actor._id).select("+passwordHash +sessionVersion +passwordResetHash");
    expect(await bcrypt.compare(newPassword, stored!.passwordHash)).toBe(true);
    expect(stored!.passwordHash).not.toBe(newPassword);
    expect(stored!.sessionVersion).toBe(1);
    expect(stored!.role).toBe(actor.role); expect(stored!.tenantId).toEqual(actor.tenantId);
    expect(stored!.passwordResetHash).toBeUndefined();
    expect((await request(app).get("/api/auth/me").set("Cookie", cookie)).status).toBe(401);
    expect((await reset(token)).status).toBe(400);
    expect((await post("login", { email: actor.email, password: newPassword })).status).toBe(200);
    expect((await post("login", { email: actor.email, password })).status).toBe(401);
  });
  it.each([
    [{ currentPassword: "incorrect", newPassword }, "INVALID_PASSWORD"],
    [{ currentPassword: password, newPassword: password }, "PASSWORD_REUSED"],
    [{ currentPassword: password, newPassword: "short" }, "VALIDATION_ERROR"],
    [{ currentPassword: password, newPassword: "ü".repeat(37) }, "VALIDATION_ERROR"],
    [{ currentPassword: password, newPassword, role: "super_admin" }, "VALIDATION_ERROR"],
  ])("rejects invalid change without mutating credentials: %j", async (input, code) => {
    const res = await change(input); expect(res.status).toBe(400); expect(res.body.error.code).toBe(code);
    expect((await User.findById(actor._id).select("+passwordHash"))!.passwordHash).toBe(hash);
  });
  it("allows exactly one concurrent change", async () => {
    const results = await Promise.all([change(), change()]);
    expect(results.filter(r => r.status === 204)).toHaveLength(1);
    expect(results.filter(r => [401, 409].includes(r.status))).toHaveLength(1);
    expect((await User.findById(actor._id).select("+sessionVersion"))!.sessionVersion).toBe(1);
  });
  it("serializes password change against token consumption", async () => {
    const token = await recover();
    const results = await Promise.all([change(), reset(token)]);
    expect(results.filter(r => r.status === 204)).toHaveLength(1);
    expect(results.filter(r => [400, 401, 409].includes(r.status))).toHaveLength(1);
    expect((await User.findById(actor._id).select("+sessionVersion"))!.sessionVersion).toBe(1);
  });
  it("accepts the 72 UTF-8 byte boundary", async () => {
    const next = "ü".repeat(36);
    expect((await change({ currentPassword: password, newPassword: next })).status).toBe(204);
    expect(await bcrypt.compare(next, (await User.findById(actor._id).select("+passwordHash"))!.passwordHash)).toBe(true);
  });
  it("rejects absent, forged and expired sessions", async () => {
    const expired = jwt.sign({ version: 0 }, secret, { subject: actor._id.toString(), expiresIn: -1, issuer: "softlans-api", audience: "softlans-web" });
    for (const value of ["", "softlans_session=forged", `softlans_session=${expired}`])
      expect((await post("change-password", { currentPassword: password, newPassword }).set("Cookie", value)).status).toBe(401);
  });
  it.each(["admin", "teacher", "super_admin"] as const)("supports current-password change for %s without widening permissions", async role => {
    actor.role = role; if (role === "super_admin") actor.tenantId = null;
    await actor.save(); await refresh();
    expect((await change()).status).toBe(204);
    expect((await User.findById(actor._id))!.role).toBe(role);
  });
  it("never targets another tenant account supplied in headers or body", async () => {
    const otherTenant = await Tenant.create({ name: "Boshqa markaz" });
    const other = await User.create({ name: "Boshqa", email: "other@password.test", role: "admin", tenantId: otherTenant._id, passwordHash: hash });
    expect((await change({ currentPassword: password, newPassword, userId: other._id })).status).toBe(400);
    expect((await change().set("X-Tenant-ID", otherTenant._id.toString())).status).toBe(204);
    expect((await User.findById(other._id).select("+passwordHash +sessionVersion"))!.passwordHash).toBe(hash);
  });
});

describe("recovery lifecycle", () => {
  it("uses a generic non-enumerating response, hashes 32-byte tokens and constructs a trusted fragment URL", async () => {
    const unknown = await post("forgot-password", { email: "absent@password.test" });
    const token = await recover();
    const known = await post("forgot-password", { email: actor.email });
    expect(unknown.status).toBe(known.status); expect(unknown.body).toEqual(known.body);
    expect(known.body).toEqual({ message: recoveryMessage });
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    const stored = await User.findById(actor._id).select("+passwordResetHash +passwordResetExpiresAt");
    expect(stored!.passwordResetHash).toBe(hashResetToken(token));
    expect(stored!.passwordResetHash).not.toBe(token);
    expect(stored!.passwordResetExpiresAt!.getTime() - Date.now()).toBeGreaterThan(14 * 60_000);
    const url = new URL(mailbox.messages[0]!.resetUrl); expect(url.origin).toBe(origin);
    expect(url.search).toBe(""); expect(url.pathname).toBe("/reset-password");
    expect(JSON.stringify((await request(app).get("/api/auth/me").set("Cookie", cookie)).body)).not.toMatch(/passwordReset|passwordHash|sessionVersion/);
    expect((await post("forgot-password", { email: actor.email, redirectUrl: "https://evil.test" })).status).toBe(400);
  });
  it("consumes once, revokes prior sessions, does not log in, and preserves other tenants", async () => {
    const other = await User.create({ name: "Boshqa", email: "other@password.test", role: "teacher", tenantId: (await Tenant.create({ name: "B" }))._id, passwordHash: hash });
    const token = await recover();
    expect((await reset(token)).status).toBe(204);
    expect((await reset(token)).status).toBe(400);
    expect((await request(app).get("/api/auth/me").set("Cookie", cookie)).status).toBe(401);
    expect((await request(app).get("/api/auth/me")).status).toBe(401);
    const updated = await User.findById(actor._id).select("+passwordHash +sessionVersion +passwordResetHash");
    expect(await bcrypt.compare(newPassword, updated!.passwordHash)).toBe(true);
    expect(updated!.sessionVersion).toBe(1); expect(updated!.passwordResetHash).toBeUndefined();
    expect((await User.findById(other._id).select("+passwordHash"))!.passwordHash).toBe(hash);
  });
  it("rejects expired, forged, malformed, weak and reused passwords without consuming a valid token", async () => {
    const token = await recover();
    expect((await reset("0".repeat(64))).status).toBe(400);
    expect((await reset("malformed")).status).toBe(400);
    expect((await post("reset-password", { token: { $ne: null }, newPassword })).status).toBe(400);
    expect((await reset(token, "short")).status).toBe(400);
    expect((await reset(token, "ü".repeat(37))).status).toBe(400);
    expect((await reset(token, password)).body.error.code).toBe("PASSWORD_REUSED");
    await User.updateOne({ _id: actor._id }, { $set: { passwordResetExpiresAt: new Date(Date.now() - 1) } });
    expect((await reset(token)).body.error.code).toBe("INVALID_RESET");
  });
  it("allows exactly one concurrent consumption", async () => {
    const token = await recover();
    const results = await Promise.all([reset(token), reset(token)]);
    expect(results.map(r => r.status).sort()).toEqual([204, 400]);
    expect((await User.findById(actor._id).select("+sessionVersion"))!.sessionVersion).toBe(1);
  });
  it("admits one concurrent request per account per minute, then supersedes the prior token", async () => {
    const results = await Promise.all(Array.from({ length: 4 }, () => post("forgot-password", { email: actor.email })));
    expect(results.every(r => r.status === 202)).toBe(true);
    await vi.waitFor(() => expect(mailbox.messages).toHaveLength(1));
    const first = mailbox.token();
    // Drain all four admissions without using a real minute of wall clock time.
    await new Promise(r => setTimeout(r, 200));
    expect(mailbox.messages).toHaveLength(1);
    await User.updateOne({ _id: actor._id }, { $set: { passwordResetRequestedAt: new Date(Date.now() - 61_000) } });
    const second = await recover();
    expect(second).not.toBe(first); expect((await reset(first)).status).toBe(400); expect((await reset(second)).status).toBe(204);
  });
  it.each(["admin", "teacher"] as const)("recovers %s with tenant and role unchanged", async role => {
    actor.role = role; await actor.save();
    expect((await reset(await recover())).status).toBe(204);
    const stored = await User.findById(actor._id); expect(stored!.role).toBe(role); expect(stored!.tenantId).toEqual(tenant._id);
  });
  it("denies Super Admin public recovery with the same generic response", async () => {
    actor.role = "super_admin"; actor.tenantId = null; await actor.save();
    // Even a preexisting/manually forged stored token cannot recover a privileged account.
    const token = randomBytes(32).toString("hex");
    await User.updateOne({ _id: actor._id }, { $set: { passwordResetHash: hashResetToken(token), passwordResetExpiresAt: new Date(Date.now() + 60_000) } });
    expect((await post("forgot-password", { email: actor.email })).body).toEqual({ message: recoveryMessage });
    expect((await reset(token)).status).toBe(400);
    await new Promise(r => setTimeout(r, 100)); expect(mailbox.messages).toHaveLength(0);
  });
  it.each(["user", "tenant"])("rejects disabled %s at request, confirmation and authenticated change", async kind => {
    const token = await recover();
    const model = kind === "user" ? User : Tenant;
    await (model as typeof User).updateOne({ _id: kind === "user" ? actor._id : tenant._id }, { active: false });
    expect((await reset(token)).status).toBe(400); expect((await change()).status).toBe(401);
    expect((await post("forgot-password", { email: actor.email })).body).toEqual({ message: recoveryMessage });
    await new Promise(r => setTimeout(r, 100)); expect(mailbox.messages).toHaveLength(1);
  });
});

describe("abuse, configuration and delivery privacy", () => {
  it("fails closed without provider; test adapters cannot be injected in production", async () => {
    app = createApp(config);
    expect((await request(app).get("/api/auth/password-recovery")).body).toEqual({ enabled: false });
    expect((await post("forgot-password", { email: actor.email })).status).toBe(503);
    expect((await reset(randomBytes(32).toString("hex"))).status).toBe(503);
    for (const vars of [{ PASSWORD_RECOVERY_ENABLED: "true" }, { PASSWORD_RECOVERY_ENABLED: "true", PASSWORD_EMAIL_DELIVERY_VERIFIED: "true" }])
      expect(() => parseConfig({ NODE_ENV: "test", APP_ORIGIN: origin, JWT_SECRET: secret, MONGODB_URI: config.MONGODB_URI, ...vars })).toThrow();
    expect(() => createApp({ ...config, NODE_ENV: "production" }, { testPasswordEmail: mailbox })).toThrow(/test-only/);
    expect(mailbox.messages).toHaveLength(0);
  });
  it("hides provider failures, revokes failed tokens and logs only an allowlisted event", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mailbox.fail = true;
    const res = await post("forgot-password", { email: actor.email });
    expect(res.status).toBe(202); expect(res.body).toEqual({ message: recoveryMessage });
    await vi.waitFor(() => expect(spy).toHaveBeenCalledWith(JSON.stringify({ event: "password_recovery_delivery_failed" })));
    await vi.waitFor(async () => expect((await User.findById(actor._id).select("+passwordResetHash"))!.passwordResetHash).toBeUndefined());
    expect(spy.mock.calls).toEqual([[JSON.stringify({ event: "password_recovery_delivery_failed" })]]);
  });
  it("cannot erase a newer token when an earlier delivery fails late", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const send = mailbox.sendReset.bind(mailbox);
    let fail!: () => void;
    let started = false;
    vi.spyOn(mailbox, "sendReset").mockImplementationOnce(() => new Promise<void>((_resolve, reject) => {
      fail = () => reject(new Error("Private provider failure")); started = true;
    })).mockImplementation(send);
    expect((await post("forgot-password", { email: actor.email })).status).toBe(202);
    await vi.waitFor(() => expect(started).toBe(true));
    await User.updateOne({ _id: actor._id }, { $set: { passwordResetRequestedAt: new Date(Date.now() - 61_000) } });
    const newer = await recover(); fail();
    await vi.waitFor(() => expect(log).toHaveBeenCalledOnce());
    expect((await reset(newer)).status).toBe(204);
  });
  it("rejects redirect/query inputs and unsafe email gateway configuration", async () => {
    for (const path of ["change-password", "forgot-password", "reset-password"])
      expect((await post(`${path}?redirectUrl=https://evil.test`, {})).status).toBe(400);
    for (const endpoint of ["http://gateway.test/send", "https://user:pass@gateway.test/send", "https://gateway.test/send?token=secret", "https://gateway.test/send#secret"])
      expect(() => parseConfig({ NODE_ENV: "production", APP_ORIGIN: "https://app.test", JWT_SECRET: secret,
        MONGODB_URI: config.MONGODB_URI, PASSWORD_EMAIL_ENDPOINT: endpoint })).toThrow();
  });
  it("enforces Origin/JSON protection for all new writes and rate limits requests", async () => {
    for (const path of ["change-password", "forgot-password", "reset-password"]) {
      for (const value of ["", "https://evil.test"])
        expect((await request(app).post(`/api/auth/${path}`).set("Origin", value).send({})).status).toBe(403);
      expect((await request(app).post(`/api/auth/${path}`).set("Origin", origin).type("form").send({})).status).toBe(415);
    }
    for (let i = 0; i < 5; i++) expect((await post("forgot-password", {})).status).toBe(400);
    const limited = await post("forgot-password", {}); expect(limited.status).toBe(429); expect(limited.headers["retry-after"]).toBeTruthy();
    for (const path of ["change-password", "reset-password"]) {
      for (let i = 0; i < 10; i++) await post(path, {});
      expect((await post(path, {})).status).toBe(429);
    }
  });
  it("does not log tokens, hashes or passwords for successful and malformed requests", async () => {
    const spies = [vi.spyOn(console, "error"), vi.spyOn(console, "log"), vi.spyOn(console, "warn")];
    const token = await recover();
    const res = await reset(token); expect(res.status).toBe(204);
    const malformed = await post("reset-password", { token, newPassword: { $ne: null } });
    expect(malformed.status).toBe(400);
    const output = JSON.stringify([res.body, malformed.body, spies.map(s => s.mock.calls)]);
    for (const value of [token, hash, password, newPassword]) expect(output).not.toContain(value);
  });
  it("uses the configured HTTPS gateway with no redirects, bounded timeout and Uzbek copy", async () => {
    const production = { ...config, PASSWORD_RECOVERY_ENABLED: true, PASSWORD_EMAIL_DELIVERY_VERIFIED: true,
      PASSWORD_EMAIL_ENDPOINT: "https://approved-gateway.example.test/send", PASSWORD_EMAIL_API_KEY: "x".repeat(40), PASSWORD_EMAIL_FROM: "recovery@example.test" };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    const adapter = configuredPasswordEmail(production)!;
    await adapter.sendReset({ to: actor.email, resetUrl: resetUrl(origin, "a".repeat(64)) });
    expect(fetchSpy.mock.calls[0]![1]!.redirect).toBe("error");
    expect(fetchSpy.mock.calls[0]![1]!.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string).subject).toMatch(/parolni tiklash/);
    fetchSpy.mockResolvedValue(new Response("secret-provider-error", { status: 500 }));
    await expect(adapter.sendReset({ to: actor.email, resetUrl: "secret" })).rejects.toThrow("Password email gateway rejected delivery");
    expect(configuredPasswordEmail(config)).toBeUndefined();
  });
});
