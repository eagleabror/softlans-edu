import { randomBytes } from "node:crypto";
import { DeviceSession } from "./security-models.js";
import type { ClientSession } from "mongoose";
import type { Request, RequestHandler } from "express";
import jwt from "jsonwebtoken";
import type { Config } from "./config.js";
import { Student, Tenant, User, type UserRecord } from "./models.js";
import { AppError } from "./errors.js";
import type { Role } from "@softlans/contracts";
import type { Types } from "mongoose";
import { subscriptionEntitlement } from "./saas-entitlements.js";

export interface Principal {
  userId: Types.ObjectId;
  tenantId: Types.ObjectId | null;
  role: Role;
  user: UserRecord;
  sessionId?: string;
}
declare global {
  namespace Express {
    interface Request {
      principal?: Principal;
    }
  }
}
export const COOKIE_NAME = "softlans_session";
export const SESSION_MS = 60 * 60 * 1000;
export const cookieOptions = (config: Config) => ({
  httpOnly: true,
  secure: config.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/api",
  maxAge: SESSION_MS,
});
export function issueToken(user: UserRecord, config: Config, sid?: string, mfa = false) {
  return jwt.sign({ version: user.sessionVersion, ...(sid ? { sid, mfa } : {}) }, config.JWT_SECRET, {
    algorithm: "HS256",
    subject: user._id.toString(),
    expiresIn: "1h",
    issuer: "softlans-api",
    audience: "softlans-web",
  });
}
/** Only coarse, allowlisted device labels; no raw UA, IP, or JWT is persisted. */
export async function createSession(user: UserRecord, config: Config, req?: Request, mfa = false, transaction?: ClientSession) {
  const ua = req?.get("user-agent") ?? "";
  const platform = /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iOS" : /Windows/i.test(ua) ? "Windows" : /Macintosh/i.test(ua) ? "macOS" : /Linux/i.test(ua) ? "Linux" : "Qurilma";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Brauzer";
  const sid = randomBytes(32).toString("hex");
  const now = new Date();
  await DeviceSession.create([{ sid, userId: user._id, version: user.sessionVersion, mfa,
    device: `${platform} · ${browser}`, createdAt: now, lastActivityAt: now,
    expiresAt: new Date(now.getTime() + SESSION_MS) }], { session: transaction });
  return issueToken(user, config, sid, mfa);
}
export const authenticate =
  (config: Config): RequestHandler =>
  async (req, _res, next) => {
    try {
      const token: unknown = req.cookies?.[COOKIE_NAME];
      if (typeof token !== "string") throw new Error();
      const payload = jwt.verify(token, config.JWT_SECRET, {
        algorithms: ["HS256"],
        issuer: "softlans-api",
        audience: "softlans-web",
      });
      if (
        typeof payload === "string" ||
        typeof payload.sub !== "string" ||
        !/^[a-f\d]{24}$/i.test(payload.sub) ||
        !Number.isInteger(payload.version)
      )
        throw new Error();
      const user = await User.findById(payload.sub).select("+sessionVersion +mfaEnabled");
      if (!user || !user.active || user.sessionVersion !== payload.version)
        throw new Error();
      if (user.role === "super_admin" ? user.tenantId !== null : !user.tenantId)
        throw new Error();
      if (
        user.tenantId &&
        !(await Tenant.exists({ _id: user.tenantId, active: true }))
      )
        throw new Error();
      if (!(await studentAccountAvailable(user))) throw new Error();
      if ((user.mfaEnabled || (user.role === "super_admin" && config.SUPER_ADMIN_MFA_ENFORCED)) && payload.mfa !== true)
        throw new Error();
      let sessionId: string | undefined;
      if (typeof payload.sid === "string" && /^[a-f0-9]{64}$/.test(payload.sid)) {
        const session = await DeviceSession.findOne({ sid: payload.sid, userId: user._id,
          version: user.sessionVersion, mfa: payload.mfa === true, revokedAt: { $exists: false }, expiresAt: { $gt: new Date() } });
        if (!session) throw new Error();
        sessionId = session.sid;
        // Activity precision is deliberately limited to one minute.
        await DeviceSession.updateOne({ _id: session._id, lastActivityAt: { $lt: new Date(Date.now() - 60_000) } },
          { $set: { lastActivityAt: new Date() } });
      } else {
        const cutoff = config.SESSION_LEGACY_ISSUED_BEFORE ? Date.parse(config.SESSION_LEGACY_ISSUED_BEFORE) : 0;
        if (payload.sid !== undefined || typeof payload.iat !== "number" || payload.iat * 1000 > cutoff || Date.now() > cutoff + SESSION_MS)
          throw new Error();
      }
      req.principal = {
        sessionId,
        userId: user._id,
        tenantId: user.tenantId ?? null,
        role: user.role,
        user,
      };
    } catch (error) {
      // DB failures must remain server failures instead of masquerading as bad credentials.
      if (error instanceof Error && /Mongo|Mongoose/.test(error.name)) {
        next(error);
        return;
      }
      next(new AppError(401, "UNAUTHENTICATED", "Hisobingizga kiring."));
      return;
    }
    // Subscription denial is distinct from authentication and administrative blocking.
    await subscriptionEntitlement(req, _res, next);
  };
/** The link is server-owned and checked on login, MFA completion and every request. */
export async function studentAccountAvailable(user: UserRecord, session?: ClientSession) {
  if (user.role !== "student") return user.studentId == null;
  if (!user.studentId || !user.tenantId) return false;
  return Boolean(await Student.exists({
    _id: user.studentId, tenantId: user.tenantId, status: { $ne: "archived" },
  }).session(session ?? null));
}
export function principal(req: Express.Request): Principal {
  if (!req.principal)
    throw new AppError(401, "UNAUTHENTICATED", "Hisobingizga kiring.");
  return req.principal;
}
export function requireRoles(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    const actor = principal(req);
    if (!roles.includes(actor.role))
      throw new AppError(403, "FORBIDDEN", "Bu amal uchun ruxsat yo‘q.");
    next();
  };
}
export function tenantScope(actor: Principal) {
  if (!actor.tenantId || actor.role === "super_admin")
    throw new AppError(403, "TENANT_REQUIRED", "Markaz hisobi talab qilinadi.");
  return { tenantId: actor.tenantId };
}
export function canCreateRole(actor: Role, target: Role) {
  return actor === "business_owner"
    ? target === "admin" || target === "teacher"
    : actor === "admin" && target === "teacher";
}
// Reject cross-origin writes, including login CSRF. Same-origin fetch includes Origin.
export const protectWrites =
  (config: Config): RequestHandler =>
  (req, _res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (req.get("origin") !== config.APP_ORIGIN)
        throw new AppError(
          403,
          "INVALID_ORIGIN",
          "So‘rov manbasiga ruxsat berilmagan.",
        );
      if (!req.is("application/json"))
        throw new AppError(
          415,
          "JSON_REQUIRED",
          "JSON formati talab qilinadi.",
        );
    }
    next();
  };
