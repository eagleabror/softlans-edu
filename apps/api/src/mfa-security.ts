import { Router, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import mongoose, { type ClientSession, type Types } from "mongoose";
import QRCode from "qrcode";
import { z } from "zod";
import type { Config } from "./config.js";
import { Tenant, User, type UserRecord } from "./models.js";
import { DeviceSession, MfaChallenge } from "./security-models.js";
import { AppError } from "./errors.js";
import { authenticate, principal, createSession, COOKIE_NAME, cookieOptions } from "./security.js";
import { acceptedStep, digest, encryptionKey, newSecret, recoveryCodes, recoveryDigest, seal, totp, unseal } from "./mfa-crypto.js";

const fields = "+passwordHash +sessionVersion +mfaEnabled +mfaSecret +mfaPendingSecret +mfaPendingExpiresAt +mfaLastStep +mfaRecoveryHashes +mfaRevision";
const CHALLENGE_COOKIE = "softlans_mfa";
const FIVE_MIN = 5 * 60_000;
const challengeOptions = (config: Config) => ({ ...cookieOptions(config), path: "/api/auth/mfa", maxAge: FIVE_MIN });
const invalid = () => new AppError(401, "MFA_INVALID", "Kod yaroqsiz, ishlatilgan yoki muddati tugagan. Qayta urinib ko‘ring.");
const conflict = () => new AppError(409, "SECURITY_CHANGED", "Hisob holati o‘zgargan. Hisobingizga qayta kiring.");
const proof = z.object({ password: z.string().min(1).max(72), code: z.string().max(64).optional() }).strict();
const codeSchema = z.object({ code: z.string().min(6).max(64) }).strict();
const pendingClear = { mfaPendingSecret: 1, mfaPendingExpiresAt: 1 };
const limit = (count: number) => rateLimit({ windowMs: FIVE_MIN, limit: count, standardHeaders: "draft-8", legacyHeaders: false,
  handler: (_req, _res, next) => next(new AppError(429, "RATE_LIMITED", "Urinishlar ko‘p. 5 daqiqadan so‘ng qayta urinib ko‘ring.")) });

// Shared durable per-account budget across processes and challenges; never reset on login.
async function reserveAttempt(userId: Types.ObjectId) {
  const now = new Date();
  await User.updateOne({ _id: userId, $or: [{ mfaWindowStart: { $exists: false } }, { mfaWindowStart: { $lte: new Date(now.getTime() - FIVE_MIN) } }] },
    { $set: { mfaWindowStart: now, mfaAttemptCount: 0 } });
  const result = await User.updateOne({ _id: userId, mfaAttemptCount: { $lt: 5 } }, { $inc: { mfaAttemptCount: 1 } });
  if (result.modifiedCount !== 1) throw new AppError(429, "MFA_COOLDOWN", "Urinishlar limiti tugadi. 5 daqiqadan so‘ng qayta urinib ko‘ring.");
}
async function lockedUser(id: Types.ObjectId, version: number, session: ClientSession) {
  const user = await User.findOneAndUpdate({ _id: id, active: true, sessionVersion: version },
    { $inc: { securityRevision: 1 } }, { new: true, session }).select(fields);
  if (!user || (user.role === "super_admin" ? user.tenantId !== null : !user.tenantId)) throw conflict();
  if (user.tenantId) {
    const result = await Tenant.updateOne({ _id: user.tenantId, active: true }, { $inc: { passwordSecurityRevision: 1 } }, { session });
    if (result.matchedCount !== 1) throw conflict();
  }
  return user;
}
async function consumeFactor(user: UserRecord, code: string, config: Config, session: ClientSession) {
  if (!user.mfaEnabled || !user.mfaSecret) throw invalid();
  const hash = recoveryDigest(code);
  if (hash) {
    const result = await User.updateOne({ _id: user._id, mfaRecoveryHashes: hash }, { $pull: { mfaRecoveryHashes: hash } }, { session });
    if (result.modifiedCount !== 1) throw invalid();
  } else {
    const step = acceptedStep(unseal(user.mfaSecret, user._id.toString(), config), code, user.mfaLastStep);
    if (step === null) throw invalid();
    await User.updateOne({ _id: user._id }, { $set: { mfaLastStep: step } }, { session });
  }
}
export async function beginLoginChallenge(user: UserRecord, config: Config, res: Response) {
  encryptionKey(config); // Fail closed if a configured account cannot decrypt its MFA key.
  const token = randomBytes(32).toString("hex");
  await MfaChallenge.create({ digest: digest(token), userId: user._id, version: user.sessionVersion,
    revision: user.mfaRevision, expiresAt: new Date(Date.now() + FIVE_MIN) });
  const { maxAge: _, ...clear } = cookieOptions(config);
  res.clearCookie(COOKIE_NAME, clear);
  res.cookie(CHALLENGE_COOKIE, token, challengeOptions(config));
  res.json({ mfaRequired: true });
}
export async function passwordSession(user: UserRecord, config: Config, req: Request) {
  return mongoose.connection.transaction(async session => {
    const current = await lockedUser(user._id, user.sessionVersion, session);
    if (current.mfaEnabled || (current.role === "super_admin" && config.SUPER_ADMIN_MFA_ENFORCED) || current.passwordHash !== user.passwordHash)
      throw conflict();
    return createSession(current, config, req, false, session);
  });
}

export function mfaSecurityRouter(config: Config, view: (user: UserRecord) => Promise<unknown>) {
  const router = Router();
  router.use(["/mfa", "/security", "/sessions"], (req, _res, next) => {
    if (Object.keys(req.query).length) throw new AppError(400, "BAD_REQUEST", "So‘rov parametrlari noto‘g‘ri.");
    next();
  });
  router.post("/mfa/verify", limit(30), async (req, res) => {
    const input = codeSchema.parse(req.body);
    const token: unknown = req.cookies?.[CHALLENGE_COOKIE];
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) throw invalid();
    const challenge = await MfaChallenge.findOneAndUpdate({ digest: digest(token), consumedAt: { $exists: false },
      attempts: { $lt: 5 }, expiresAt: { $gt: new Date() } }, { $inc: { attempts: 1 } }, { new: true });
    if (!challenge) throw invalid();
    await reserveAttempt(challenge.userId);
    const result = await mongoose.connection.transaction(async session => {
      const user = await lockedUser(challenge.userId, challenge.version, session);
      if (user.mfaRevision !== challenge.revision) throw invalid();
      const consumed = await MfaChallenge.updateOne({ _id: challenge._id, consumedAt: { $exists: false }, expiresAt: { $gt: new Date() } },
        { $set: { consumedAt: new Date() } }, { session });
      if (consumed.modifiedCount !== 1) throw invalid();
      await consumeFactor(user, input.code, config, session);
      const token = await createSession(user, config, req, true, session);
      return { token, user };
    });
    res.clearCookie(CHALLENGE_COOKIE, challengeOptions(config));
    res.cookie(COOKIE_NAME, result.token, cookieOptions(config));
    res.json(await view(result.user));
  });
  router.post("/mfa/cancel", limit(30), async (req, res) => {
    const token: unknown = req.cookies?.[CHALLENGE_COOKIE];
    if (typeof token === "string") await MfaChallenge.deleteOne({ digest: digest(token) });
    res.clearCookie(CHALLENGE_COOKIE, challengeOptions(config)).status(204).end();
  });
  router.get("/security", authenticate(config), async (req, res) => {
    const user = await User.findById(principal(req).userId).select(fields);
    if (!user) throw conflict();
    res.json({ enabled: user.mfaEnabled, available: Boolean(config.MFA_ENCRYPTION_KEY),
      recoveryCodesRemaining: user.mfaRecoveryHashes.length,
      superAdminEnforced: user.role === "super_admin" && config.SUPER_ADMIN_MFA_ENFORCED });
  });

  // Password is verified in this request; no reusable browser-side reauthentication token.
  async function settings<T>(req: Request, action: (user: UserRecord, session: ClientSession, code?: string) => Promise<T>, strong = true) {
    const input = proof.parse(req.body);
    const actor = principal(req);
    await reserveAttempt(actor.userId);
    return mongoose.connection.transaction(async session => {
      const user = await lockedUser(actor.userId, actor.user.sessionVersion, session);
      if (!await bcrypt.compare(input.password, user.passwordHash)) throw invalid();
      if (user.mfaEnabled && strong) await consumeFactor(user, input.code ?? "", config, session);
      // Serialize settings with current-device revocation. Legacy sessions must log in again.
      if (!actor.sessionId) throw conflict();
      const active = await DeviceSession.updateOne({ sid: actor.sessionId, userId: user._id, revokedAt: { $exists: false }, expiresAt: { $gt: new Date() } },
        { $set: { lastActivityAt: new Date() } }, { session });
      if (active.matchedCount !== 1) throw conflict();
      return action(user, session, input.code);
    });
  }
  router.post("/security/enroll", limit(10), authenticate(config), async (req, res) => {
    encryptionKey(config);
    const result = await settings(req, async (user, session) => {
      if (user.mfaEnabled) throw conflict();
      const secret = newSecret();
      await User.updateOne({ _id: user._id }, { $set: { mfaPendingSecret: seal(secret, user._id.toString(), config),
        mfaPendingExpiresAt: new Date(Date.now() + 10 * 60_000) } }, { session });
      // Only this password-verified enrollment response contains provisioning material.
      return { qrDataUrl: await QRCode.toDataURL(totp(secret, user.email).toString(), { errorCorrectionLevel: "M", width: 240 }),
        expiresInSeconds: 600 };
    });
    res.json(result);
  });
  router.post("/security/confirm", limit(10), authenticate(config), async (req, res) => {
    const result = await settings(req, async (user, session, code) => {
      if (user.mfaEnabled || !user.mfaPendingSecret || !user.mfaPendingExpiresAt || user.mfaPendingExpiresAt.getTime() <= Date.now()) throw invalid();
      const step = acceptedStep(unseal(user.mfaPendingSecret, user._id.toString(), config), code ?? "", -1);
      if (step === null) throw invalid();
      const recovery = recoveryCodes();
      await User.updateOne({ _id: user._id }, { $set: { mfaEnabled: true, mfaSecret: user.mfaPendingSecret, mfaLastStep: step,
        mfaRecoveryHashes: recovery.hashes }, $unset: pendingClear, $inc: { sessionVersion: 1, mfaRevision: 1 } }, { session });
      user.sessionVersion++;
      const token = await createSession(user, config, req, true, session);
      return { token, codes: recovery.codes };
    }, false);
    res.cookie(COOKIE_NAME, result.token, cookieOptions(config));
    res.json({ recoveryCodes: result.codes });
  });
  router.post("/security/cancel", limit(10), authenticate(config), async (req, res) => {
    await settings(req, async (user, session) => { await User.updateOne({ _id: user._id }, { $unset: pendingClear }, { session }); }, false);
    res.status(204).end();
  });
  router.post("/security/recovery-codes", limit(10), authenticate(config), async (req, res) => {
    const result = await settings(req, async (user, session) => {
      if (!user.mfaEnabled) throw invalid();
      const recovery = recoveryCodes();
      await User.updateOne({ _id: user._id }, { $set: { mfaRecoveryHashes: recovery.hashes }, $inc: { mfaRevision: 1 } }, { session });
      return { recoveryCodes: recovery.codes };
    });
    res.json(result);
  });
  router.post("/security/disable", limit(10), authenticate(config), async (req, res) => {
    await settings(req, async (user, session) => {
      if (user.role === "super_admin" && config.SUPER_ADMIN_MFA_ENFORCED)
        throw new AppError(403, "MFA_REQUIRED", "Super administrator uchun ikki bosqichli himoya majburiy.");
      if (!user.mfaEnabled) throw invalid();
      await User.updateOne({ _id: user._id }, { $set: { mfaEnabled: false, mfaRecoveryHashes: [], mfaLastStep: -1 },
        $unset: { mfaSecret: 1, ...pendingClear }, $inc: { sessionVersion: 1, mfaRevision: 1 } }, { session });
    });
    res.clearCookie(COOKIE_NAME, cookieOptions(config)).status(204).end();
  });
  router.get("/sessions", authenticate(config), async (req, res) => {
    const actor = principal(req);
    const sessions = await DeviceSession.find({ userId: actor.userId, version: actor.user.sessionVersion,
      revokedAt: { $exists: false }, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 }).limit(100).lean();
    const minute = (value: Date) => new Date(Math.floor(value.getTime() / 60_000) * 60_000).toISOString();
    res.json({ legacy: !actor.sessionId, sessions: sessions.map(s => ({ id: s._id.toString(), current: s.sid === actor.sessionId,
      device: s.device, signedInAt: minute(s.createdAt), lastActivityAt: minute(s.lastActivityAt) })) });
  });
  router.post("/sessions/revoke", limit(30), authenticate(config), async (req, res) => {
    const { id } = z.object({ id: z.string().regex(/^[a-f0-9]{24}$/) }).strict().parse(req.body);
    const actor = principal(req);
    const session = await DeviceSession.findOneAndUpdate({ _id: id, userId: actor.userId, version: actor.user.sessionVersion,
      revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } });
    if (!session) throw new AppError(404, "NOT_FOUND", "Sessiya topilmadi.");
    if (session.sid === actor.sessionId) res.clearCookie(COOKIE_NAME, cookieOptions(config));
    res.json({ currentRevoked: session.sid === actor.sessionId });
  });
  router.post("/sessions/revoke-others", limit(10), authenticate(config), async (req, res) => {
    // Version bump also revokes legacy JWTs, outstanding challenges and concurrent logins.
    const token = await settings(req, async (user, session) => {
      await User.updateOne({ _id: user._id }, { $inc: { sessionVersion: 1 } }, { session });
      user.sessionVersion++;
      return createSession(user, config, req, user.mfaEnabled, session);
    });
    res.cookie(COOKIE_NAME, token, cookieOptions(config)).status(204).end();
  });
  return router;
}
