import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import type { Config } from "./config.js";
import { Tenant, User, type UserRecord } from "./models.js";
import { AppError } from "./errors.js";
import type { Role } from "@softlans/contracts";
import type { Types } from "mongoose";

export interface Principal {
  userId: Types.ObjectId;
  tenantId: Types.ObjectId | null;
  role: Role;
  user: UserRecord;
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
export function issueToken(user: UserRecord, config: Config) {
  return jwt.sign({ version: user.sessionVersion }, config.JWT_SECRET, {
    algorithm: "HS256",
    subject: user._id.toString(),
    expiresIn: "1h",
    issuer: "softlans-api",
    audience: "softlans-web",
  });
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
      const user = await User.findById(payload.sub).select("+sessionVersion");
      if (!user || !user.active || user.sessionVersion !== payload.version)
        throw new Error();
      if (user.role === "super_admin" ? user.tenantId !== null : !user.tenantId)
        throw new Error();
      if (
        user.tenantId &&
        !(await Tenant.exists({ _id: user.tenantId, active: true }))
      )
        throw new Error();
      req.principal = {
        userId: user._id,
        tenantId: user.tenantId ?? null,
        role: user.role,
        user,
      };
      next();
    } catch (error) {
      // DB failures must remain server failures instead of masquerading as bad credentials.
      if (error instanceof Error && /Mongo|Mongoose/.test(error.name)) {
        next(error);
        return;
      }
      next(new AppError(401, "UNAUTHENTICATED", "Hisobingizga kiring."));
    }
  };
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
