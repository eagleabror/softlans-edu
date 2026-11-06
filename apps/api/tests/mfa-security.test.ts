import jwt from "jsonwebtoken";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import request from "supertest";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import { connectDatabase } from "../src/db.js";
import { ensureIndexes, Tenant, User } from "../src/models.js";
import { DeviceSession, MfaChallenge } from "../src/security-models.js";
import { createSession, issueToken } from "../src/security.js";
import { acceptedStep, newSecret, recoveryCodes, seal, totp, unseal } from "../src/mfa-crypto.js";
import { hashResetToken } from "../src/password-security.js";
import { TestPasswordEmail } from "./helpers/password-email.js";

const origin = "http://localhost:5173", password = "Synthetic-mfa-password-2026!";
let repl: MongoMemoryReplSet;
let config: ReturnType<typeof parseConfig>, app: ReturnType<typeof createApp>;
let user: Awaited<ReturnType<typeof User.create>>, tenant: Awaited<ReturnType<typeof Tenant.create>>;
let cookie: string, secret: string, hashes: string[], codes: string[], hash: string;
const cookieOf = (res: request.Response, name = "softlans_session") => (res.headers["set-cookie"] as unknown as string[]).find(c => c.startsWith(`${name}=`))!.split(";")[0]!;
const post = (path: string, body: unknown = {}, auth = cookie) => request(app).post(`/api/auth/${path}`).set("Origin", origin).set("Cookie", auth).send(body);
const get = (path: string, auth = cookie) => request(app).get(`/api/${path}`).set("Cookie", auth);
async function login() { return post("login", { email: user.email, password }, ""); }
async function enable() {
  ({ codes, hashes } = recoveryCodes());
  await User.updateOne({ _id: user._id }, { $set: { mfaEnabled: true, mfaSecret: seal(secret, user._id.toString(), config), mfaRecoveryHashes: hashes } });
  const fresh = await User.findById(user._id).select("+sessionVersion");
  cookie = `softlans_session=${await createSession(fresh!, config, undefined, true)}`;
}
async function challenge() { const res = await login(); expect(res.body).toEqual({ mfaRequired: true }); return cookieOf(res, "softlans_mfa"); }
async function resetBudget() { await User.updateOne({ _id: user._id }, { $set: { mfaAttemptCount: 0 }, $unset: { mfaWindowStart: 1 } }); }
beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: "7.0.24" } });
  config = parseConfig({ NODE_ENV: "test", MONGODB_URI: repl.getUri("mfa_security_disposable"), APP_ORIGIN: origin,
    JWT_SECRET: randomBytes(48).toString("hex"), MFA_ENCRYPTION_KEY: randomBytes(32).toString("hex") });
  await connectDatabase(config.MONGODB_URI); await ensureIndexes(); hash = await bcrypt.hash(password, 12);
});
beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Tenant.deleteMany({}), DeviceSession.deleteMany({}), MfaChallenge.deleteMany({})]);
  tenant = await Tenant.create({ name: "MFA sinov markazi" });
  user = await User.create({ name: "Sinov", email: "mfa@synthetic.test", role: "business_owner", tenantId: tenant._id, passwordHash: hash });
  cookie = `softlans_session=${await createSession(user, config)}`; secret = newSecret();
  app = createApp(config, { testPasswordEmail: new TestPasswordEmail() });
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => { await mongoose.disconnect(); await repl?.stop(); });

describe("RFC 6238 and authenticated encryption", () => {
  it("matches the RFC SHA1 vector using six digits, and rejects invalid, expired and replayed codes", () => {
    const rfc = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    expect(totp(rfc).generate({ timestamp: 59_000 })).toBe("287082");
    expect(acceptedStep(rfc, "287082", -1, 59_000)).toBe(1);
    expect(acceptedStep(rfc, "287082", 1, 59_000)).toBeNull();
    expect(acceptedStep(rfc, "287082", -1, 120_000)).toBeNull();
    expect(acceptedStep(rfc, "invalid", -1, 59_000)).toBeNull();
  });
  it("accepts only adjacent clock steps including exact boundaries", () => {
    const now = 1_800_000;
    for (const delta of [-2, -1, 0, 1, 2]) {
      const code = totp(secret).generate({ timestamp: now + delta * 30_000 });
      expect(acceptedStep(secret, code, -1, now)).toBe(Math.abs(delta) <= 1 ? now / 30_000 + delta : null);
    }
    const old = totp(secret).generate({ timestamp: now - 30_000 });
    expect(acceptedStep(secret, old, -1, now + 29_999)).not.toBeNull();
    expect(acceptedStep(secret, old, -1, now + 30_000)).toBeNull();
  });
  it("uses random secrets/nonces and detects tampering, wrong keys and cross-account ciphertext", () => {
    expect(newSecret()).not.toBe(newSecret());
    const a = seal(secret, user.id, config), b = seal(secret, user.id, config);
    expect(a).not.toBe(b); expect(a).not.toContain(secret); expect(unseal(a, user.id, config)).toBe(secret);
    expect(() => unseal(a, "another-account", config)).toThrow();
    expect(() => unseal(a, user.id, { ...config, MFA_ENCRYPTION_KEY: randomBytes(32).toString("hex") })).toThrow();
    expect(() => unseal(a.slice(0, -2) + (a.endsWith("00") ? "ff" : "00"), user.id, config)).toThrow();
    expect(() => parseConfig({ ...process.env, NODE_ENV: "test", MONGODB_URI: config.MONGODB_URI, APP_ORIGIN: origin, JWT_SECRET: "a".repeat(64), MFA_ENCRYPTION_KEY: "a".repeat(64) })).toThrow();
  });
});
describe("enrollment and sensitive changes", () => {
  it("requires password, confirms the code before enabling, returns codes once, and invalidates previous sessions", async () => {
    expect((await post("security/enroll", { password: "bad" })).status).toBe(401);
    const started = await post("security/enroll", { password }); expect(started.status).toBe(200);
    expect(started.body.qrDataUrl).toMatch(/^data:image\/png;base64,/); expect(Object.keys(started.body)).toEqual(["qrDataUrl", "expiresInSeconds"]);
    let stored = await User.findById(user._id).select("+mfaEnabled +mfaPendingSecret"); expect(stored!.mfaEnabled).toBe(false);
    const pending = unseal(stored!.mfaPendingSecret!, user.id, config);
    expect((await post("security/confirm", { password, code: "badbad" })).status).toBe(401);
    const result = await post("security/confirm", { password, code: totp(pending).generate() }); expect(result.status).toBe(200);
    expect(result.body.recoveryCodes).toHaveLength(10); expect(new Set(result.body.recoveryCodes).size).toBe(10);
    expect((await get("auth/me")).status).toBe(401); cookie = cookieOf(result);
    const status = await get("auth/security"); expect(status.body.enabled).toBe(true); expect(status.body.recoveryCodesRemaining).toBe(10);
    expect(JSON.stringify(status.body)).not.toMatch(/qrDataUrl|mfaSecret|recoveryHashes/);
    expect((await post("security/confirm", { password, code: totp(pending).generate() })).status).toBe(401);
    stored = await User.findById(user._id).select("+mfaPendingSecret"); expect(stored!.mfaPendingSecret).toBeUndefined();
    expect(JSON.stringify(await User.findById(user._id))).not.toContain(pending);
  });
  it("cancels enrollment, rejects expired setup, and preserves password-only login until confirmed", async () => {
    await post("security/enroll", { password }); expect((await login()).body.mfaRequired).toBeUndefined();
    expect((await post("security/cancel", { password })).status).toBe(204);
    expect((await User.findById(user._id).select("+mfaPendingSecret"))!.mfaPendingSecret).toBeUndefined();
    await post("security/enroll", { password });
    await User.updateOne({ _id: user._id }, { $set: { mfaPendingExpiresAt: new Date(0) } });
    expect((await post("security/confirm", { password, code: "123456" })).status).toBe(401);
  });
  it("requires both password and factor to disable MFA; revokes every existing session", async () => {
    await enable();
    expect((await post("security/disable", { password })).status).toBe(401);
    expect((await post("security/disable", { password: "bad", code: codes[0] })).status).toBe(401);
    expect((await post("security/disable", { password, code: codes[0] })).status).toBe(204);
    expect((await get("auth/me")).status).toBe(401);
    expect((await login()).body.mfaRequired).toBeUndefined();
  });
  it("regenerates codes only after strong reauthentication, revokes old codes and outstanding challenges", async () => {
    await enable(); const pending = await challenge();
    expect((await post("security/recovery-codes", { password })).status).toBe(401);
    const regenerated = await post("security/recovery-codes", { password, code: codes[0] }); expect(regenerated.status).toBe(200);
    expect(regenerated.body.recoveryCodes).toHaveLength(10);
    expect((await post("mfa/verify", { code: codes[1] }, pending)).status).toBe(401);
    const next = await challenge();
    expect((await post("mfa/verify", { code: codes[1] }, next)).status).toBe(401);
    expect((await post("mfa/verify", { code: regenerated.body.recoveryCodes[0] }, next)).status).toBe(200);
  });
});
describe("MFA login challenge and recovery", () => {
  it("never authenticates a password-only challenge, and rejects replayed TOTP across challenges", async () => {
    const oldCookie = cookie; await enable();
    expect((await get("auth/me", oldCookie)).status).toBe(401);
    const pending = await challenge();
    for (const path of ["auth/me", "dashboard", "super-admin/overview", "saas/subscription"])
      expect((await get(path, pending)).status).toBe(401);
    expect(await DeviceSession.countDocuments()).toBe(2);
    const code = totp(secret).generate();
    const result = await post("mfa/verify", { code }, pending); expect(result.status).toBe(200);
    expect((await get("auth/me", cookieOf(result))).status).toBe(200);
    expect((await post("mfa/verify", { code }, pending)).status).toBe(401);
    expect((await post("mfa/verify", { code }, await challenge())).status).toBe(401);
  });
  it("rejects invalid, expired, cancelled challenges and challenges with changed sessionVersion", async () => {
    await enable(); let pending = await challenge();
    expect((await post("mfa/verify", { code: "abcdef" }, pending)).status).toBe(401);
    await MfaChallenge.updateMany({}, { expiresAt: new Date(0) });
    expect((await post("mfa/verify", { code: codes[0] }, pending)).status).toBe(401);
    pending = await challenge(); await post("mfa/cancel", {}, pending);
    expect((await post("mfa/verify", { code: codes[0] }, pending)).status).toBe(401);
    pending = await challenge(); await User.updateOne({ _id: user._id }, { $inc: { sessionVersion: 1 } });
    expect((await post("mfa/verify", { code: codes[0] }, pending)).status).toBe(409);
  });
  it("atomically consumes recovery codes under concurrent challenges and never stores plaintext", async () => {
    await enable(); const a = await challenge(), b = await challenge();
    const results = await Promise.all([post("mfa/verify", { code: codes[0] }, a), post("mfa/verify", { code: codes[0] }, b)]);
    expect(results.map(r => r.status).sort()).toEqual([200, 401]);
    const stored = await User.findById(user._id).select("+mfaRecoveryHashes"); expect(stored!.mfaRecoveryHashes).toHaveLength(9);
    for (const code of codes) expect(JSON.stringify(stored)).not.toContain(code);
  });
  it("accepts only one completion for concurrent verification of the same challenge", async () => {
    await enable(); const pending = await challenge();
    const results = await Promise.all([post("mfa/verify", { code: codes[0] }, pending), post("mfa/verify", { code: codes[1] }, pending)]);
    expect(results.map(r => r.status).sort()).toEqual([200, 401]);
    expect((await User.findById(user._id).select("+mfaRecoveryHashes"))!.mfaRecoveryHashes).toHaveLength(9);
  });
  it("rolls back code/challenge consumption if session persistence fails, allowing a safe retry", async () => {
    await enable(); const pending = await challenge();
    vi.spyOn(DeviceSession, "create").mockRejectedValueOnce(new Error("Synthetic storage failure"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await post("mfa/verify", { code: codes[0] }, pending)).status).toBe(500);
    expect((await User.findById(user._id).select("+mfaRecoveryHashes"))!.mfaRecoveryHashes).toHaveLength(10);
    expect((await post("mfa/verify", { code: codes[0] }, pending)).status).toBe(200);
  });
  it("keeps MFA enabled after password reset and rejects earlier sessions/challenges", async () => {
    await enable(); const pending = await challenge();
    const token = randomBytes(32).toString("hex");
    await User.updateOne({ _id: user._id }, { passwordResetHash: hashResetToken(token), passwordResetExpiresAt: new Date(Date.now() + 60_000) });
    expect((await post("reset-password", { token, newPassword: "Changed-synthetic-password!" })).status).toBe(204);
    expect((await get("auth/me")).status).toBe(401);
    expect((await post("mfa/verify", { code: codes[0] }, pending)).status).toBe(409);
    expect((await post("login", { email: user.email, password: "Changed-synthetic-password!" }, "")).body).toEqual({ mfaRequired: true });
    expect((await User.findById(user._id).select("+mfaEnabled +mfaRecoveryHashes"))!.mfaRecoveryHashes).toHaveLength(10);
  });
});
describe("device registry, RBAC and rollout", () => {
  it("revokes one session immediately and exposes only coarse device/activity information", async () => {
    const first = cookie; const second = cookieOf(await login());
    const list = await get("auth/sessions", second); expect(list.body.sessions).toHaveLength(2);
    expect(list.body.sessions.filter((s: any) => s.current)).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toMatch(/sid|userId|version|jwt|ipAddress/i);
    const other = list.body.sessions.find((s: any) => !s.current);
    expect((await post("sessions/revoke", { id: other.id }, second)).body).toEqual({ currentRevoked: false });
    expect((await get("auth/me", first)).status).toBe(401); expect((await get("auth/me", second)).status).toBe(200);
    const stored = await DeviceSession.findOne({ revokedAt: { $exists: false } }).lean();
    expect(Object.keys(stored!)).not.toContain("token");
    expect((await post("sessions/revoke", { id: stored!._id.toString() }, second)).body.currentRevoked).toBe(true);
    expect((await get("auth/me", second)).status).toBe(401);
  });
  it("rejects expired or missing registry records and a signed session reference owned by another user", async () => {
    const fresh = await login(); const current = cookieOf(fresh);
    await DeviceSession.updateMany({}, { expiresAt: new Date(0) });
    expect((await get("auth/me", current)).status).toBe(401);
    const token = await createSession(user, config);
    const payload = jwt.decode(token) as jwt.JwtPayload;
    const other = await User.create({ name: "Boshqa", email: "session@synthetic.test", role: "admin", tenantId: tenant._id, passwordHash: hash });
    const forged = jwt.sign({ ...payload, sub: other.id }, config.JWT_SECRET, { algorithm: "HS256" });
    expect((await get("auth/me", `softlans_session=${forged}`)).status).toBe(401);
    await DeviceSession.deleteMany({});
    expect((await get("auth/me", `softlans_session=${token}`)).status).toBe(401);
  });
  it("completes concurrent enrollment confirmation once and prevents stale password sessions from escaping MFA", async () => {
    await post("security/enroll", { password });
    const pending = await User.findById(user._id).select("+mfaPendingSecret");
    const setupSecret = unseal(pending!.mfaPendingSecret!, user.id, config);
    const results = await Promise.all([post("security/confirm", { password, code: totp(setupSecret).generate() }), post("security/confirm", { password, code: totp(setupSecret).generate() })]);
    expect(results.filter(r => r.status === 200)).toHaveLength(1);
    expect(results.filter(r => [401, 409].includes(r.status))).toHaveLength(1);
    expect((await get("auth/me")).status).toBe(401);
    expect((await login()).body).toEqual({ mfaRequired: true });
  });
  it("revokes all other sessions including legacy tokens while replacing the current session", async () => {
    const other = cookieOf(await login());
    const old = issueToken(user, config); const cutoff = new Date(Date.now() + 1).toISOString();
    app = createApp({ ...config, SESSION_LEGACY_ISSUED_BEFORE: cutoff });
    const legacy = `softlans_session=${old}`; expect((await get("auth/me", legacy)).status).toBe(200);
    const result = await post("sessions/revoke-others", { password }); expect(result.status).toBe(204);
    expect((await get("auth/me", cookie)).status).toBe(401); expect((await get("auth/me", other)).status).toBe(401);
    expect((await get("auth/me", legacy)).status).toBe(401); expect((await get("auth/me", cookieOf(result))).status).toBe(200);
  });
  it("rejects legacy by default and accepts it only within the explicitly bounded migration window", async () => {
    const legacy = `softlans_session=${issueToken(user, config)}`;
    expect((await get("auth/me", legacy)).status).toBe(401);
    app = createApp({ ...config, SESSION_LEGACY_ISSUED_BEFORE: new Date(Date.now()).toISOString() });
    expect((await get("auth/me", legacy)).status).toBe(200);
    expect((await get("auth/sessions", legacy)).body.legacy).toBe(true);
    expect((await post("security/enroll", { password }, legacy)).status).toBe(409);
    app = createApp({ ...config, SESSION_LEGACY_ISSUED_BEFORE: new Date(Date.now() - 3_600_001).toISOString() });
    expect((await get("auth/me", legacy)).status).toBe(401);
  });
  it("never allows another account or tenant to revoke sessions; retains teacher RBAC after MFA", async () => {
    const otherTenant = await Tenant.create({ name: "Boshqa markaz" });
    const other = await User.create({ name: "Boshqa", email: "other@synthetic.test", passwordHash: hash, role: "teacher", tenantId: otherTenant._id });
    const otherCookie = `softlans_session=${await createSession(other, config)}`;
    const devices = (await get("auth/sessions")).body.sessions;
    expect((await post("sessions/revoke", { id: devices[0].id }, otherCookie)).status).toBe(404);
    expect((await get("auth/sessions", otherCookie)).body.sessions).toHaveLength(1);
    await User.updateOne({ _id: user._id }, { role: "teacher" }); await enable();
    const signed = cookieOf(await post("mfa/verify", { code: codes[0] }, await challenge()));
    expect((await get("super-admin/overview", signed)).status).toBe(403);
    expect((await request(app).post("/api/team").set("Origin", origin).set("Cookie", signed).send({ name: "X", email: "x@synthetic.test", password, role: "admin" })).status).toBe(403);
  });
  it.each(["user", "tenant"])("rejects disabled %s sessions and pending MFA", async kind => {
    await enable(); const pending = await challenge();
    if (kind === "user") await User.updateOne({ _id: user._id }, { active: false });
    else await Tenant.updateOne({ _id: tenant._id }, { active: false });
    expect((await get("auth/me")).status).toBe(401);
    expect((await post("mfa/verify", { code: codes[0] }, pending)).status).toBe(409);
    expect((await login()).status).toBe(401);
  });
  it("stages Super Admin enrollment safely and enforces MFA for login and existing sessions after activation", async () => {
    await User.updateOne({ _id: user._id }, { role: "super_admin", tenantId: null });
    const passwordOnly = cookieOf(await login()); expect((await get("auth/me", passwordOnly)).status).toBe(200);
    const enforced = { ...config, SUPER_ADMIN_MFA_ENFORCED: true }; app = createApp(enforced);
    expect((await login()).status).toBe(403); expect((await get("auth/me", passwordOnly)).status).toBe(401);
    app = createApp(config); cookie = passwordOnly;
    expect((await post("security/enroll", { password })).status).toBe(200);
    const pending = await User.findById(user._id).select("+mfaPendingSecret");
    const enrollmentSecret = unseal(pending!.mfaPendingSecret!, user.id, config);
    const confirmed = await post("security/confirm", { password, code: totp(enrollmentSecret).generate() });
    expect(confirmed.status).toBe(200); codes = confirmed.body.recoveryCodes;
    app = createApp(enforced, { testPasswordEmail: new TestPasswordEmail() });
    const signed = cookieOf(await post("mfa/verify", { code: codes[0] }, await challenge()));
    expect((await get("auth/me", signed)).status).toBe(200);
    expect((await post("security/disable", { password, code: codes[1] }, signed)).status).toBe(403);
    expect((await post("forgot-password", { email: user.email })).status).toBe(202);
  });
});
describe("abuse limits, CSRF and secret protection", () => {
  it("persists account cooldown across challenges and app instances and permits retry after the window", async () => {
    await enable();
    for (let i = 0; i < 5; i++) expect((await post("mfa/verify", { code: "abcdef" }, await challenge())).status).toBe(401);
    app = createApp(config); const pending = await challenge();
    expect((await post("mfa/verify", { code: codes[0] }, pending)).status).toBe(429);
    await User.updateOne({ _id: user._id }, { mfaWindowStart: new Date(Date.now() - 300_001) });
    expect((await post("mfa/verify", { code: codes[0] }, pending)).status).toBe(200);
  });
  it("bounds challenge attempts even when the account budget resets", async () => {
    await enable(); const pending = await challenge();
    for (let i = 0; i < 5; i++) expect((await post("mfa/verify", { code: "abcdef" }, pending)).status).toBe(401);
    await resetBudget(); expect((await post("mfa/verify", { code: codes[0] }, pending)).status).toBe(401);
  });
  it("requires Origin and JSON, rejects query/extra properties, applies IP limits and hides secrets from responses/logs", async () => {
    await enable(); const spies = [vi.spyOn(console, "error"), vi.spyOn(console, "log"), vi.spyOn(console, "warn")];
    for (const path of ["mfa/verify", "mfa/cancel", "security/enroll", "security/confirm", "security/cancel", "security/disable", "security/recovery-codes", "sessions/revoke", "sessions/revoke-others"]) {
      expect((await request(app).post(`/api/auth/${path}`).set("Origin", "https://evil.test").send({})).status).toBe(403);
      expect((await request(app).post(`/api/auth/${path}`).set("Origin", origin).type("form").send({})).status).toBe(415);
    }
    expect((await post("security/enroll?secret=bad", { password })).status).toBe(400);
    expect((await post("security/disable", { password, role: "super_admin" })).status).toBe(400);
    const status = await get("auth/security"); expect(status.headers["cache-control"]).toBe("no-store");
    const pending = await challenge();
    const challengeToken = pending.split("=")[1]!;
    const loginRes = await login(); expect(loginRes.headers["set-cookie"].join(";")).toMatch(/HttpOnly/);
    expect(loginRes.headers["set-cookie"].join(";")).toMatch(/SameSite=Strict/);
    for (let i = 0; i < 30; i++) await post("mfa/verify", { code: "abcdef" }, "");
    const limited = await post("mfa/verify", { code: "abcdef" }, ""); expect(limited.status).toBe(429);
    expect(limited.headers["retry-after"]).toBeTruthy();
    const output = JSON.stringify([status.body, loginRes.body, limited.body, spies.map(s => s.mock.calls)]);
    for (const value of [secret, password, challengeToken, ...codes, ...hashes]) expect(output).not.toContain(value);
    expect(JSON.stringify(await MfaChallenge.find({}))).not.toContain(challengeToken);
    app = createApp({ ...config, MFA_ENCRYPTION_KEY: undefined });
    expect((await login()).status).toBe(503);
  });
});
