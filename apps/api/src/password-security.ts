import { Router, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import bcrypt from "bcryptjs";
import mongoose, { type ClientSession, type Types } from "mongoose";
import { createHash, randomBytes } from "node:crypto";
import type { Config } from "./config.js";
import { Tenant, User } from "./models.js";
import { AppError } from "./errors.js";
import { authenticate, principal, COOKIE_NAME, cookieOptions } from "./security.js";
import { changePasswordSchema, forgotPasswordSchema, resetPasswordSchema } from "./validation.js";
import { configuredPasswordEmail, resetUrl, type PasswordEmail } from "./password-email.js";

const RESET_MS = 15 * 60_000;
const COOLDOWN_MS = 60_000;
export const recoveryMessage = "Agar hisobingiz tiklash uchun mos bo‘lsa, emailingizga yo‘riqnoma yuboriladi. Spam jildini ham tekshiring.";
const invalidReset = () => new AppError(400, "INVALID_RESET", "Tiklash havolasi yaroqsiz yoki muddati tugagan. Yangi havola so‘rang.");
export const hashResetToken = (token: string) => createHash("sha256").update(token).digest("hex");
const resetFields = { passwordResetHash: 1, passwordResetExpiresAt: 1 };
function clearSession(res: Response, config: Config) {
  const { maxAge: _, ...options } = cookieOptions(config);
  res.clearCookie(COOKIE_NAME, options);
}
async function activeTenant(tenantId: Types.ObjectId | null | undefined, session: ClientSession) {
  if (!tenantId) return;
  // Serialize with tenant blocking so a concurrent disable cannot authorize recovery.
  const result = await Tenant.updateOne({ _id: tenantId, active: true },
    { $inc: { passwordSecurityRevision: 1 } }, { session });
  if (result.matchedCount !== 1) throw invalidReset();
}
const limit = (count: number) => rateLimit({
  windowMs: RESET_MS, limit: count, standardHeaders: "draft-8", legacyHeaders: false,
  handler: (_req, _res, next) => next(new AppError(429, "RATE_LIMITED", "So‘rovlar soni ko‘p. Birozdan so‘ng qayta urinib ko‘ring.")),
});

export function passwordSecurityRouter(config: Config, testEmail?: PasswordEmail) {
  if (testEmail && config.NODE_ENV !== "test") throw new Error("Test password email is test-only");
  const email = testEmail ?? configuredPasswordEmail(config);
  const router = Router();
  router.use(["/change-password", "/forgot-password", "/reset-password"], (req, _res, next) => {
    if (Object.keys(req.query).length)
      throw new AppError(400, "BAD_REQUEST", "So‘rov parametrlari noto‘g‘ri.");
    next();
  });
  router.get("/password-recovery", (_req, res) => res.json({ enabled: Boolean(email) }));
  router.post("/change-password", limit(10), authenticate(config), async (req, res) => {
    const input = changePasswordSchema.parse(req.body);
    const actor = principal(req);
    const user = await User.findById(actor.userId).select("+passwordHash +sessionVersion");
    if (!user || !user.active || user.sessionVersion !== actor.user.sessionVersion)
      throw new AppError(401, "UNAUTHENTICATED", "Hisobingizga qayta kiring.");
    if (!await bcrypt.compare(input.currentPassword, user.passwordHash))
      throw new AppError(400, "INVALID_PASSWORD", "Joriy parol noto‘g‘ri.");
    if (await bcrypt.compare(input.newPassword, user.passwordHash))
      throw new AppError(400, "PASSWORD_REUSED", "Yangi parol joriy paroldan farq qilishi kerak.");
    const passwordHash = await bcrypt.hash(input.newPassword, 12);
    await mongoose.connection.transaction(async session => {
      await activeTenant(user.tenantId, session);
      const result = await User.updateOne({
        _id: user._id, active: true, passwordHash: user.passwordHash,
        sessionVersion: user.sessionVersion, role: user.role, tenantId: user.tenantId,
      }, { $set: { passwordHash }, $inc: { sessionVersion: 1 }, $unset: resetFields }, { session });
      if (result.modifiedCount !== 1)
        throw new AppError(409, "PASSWORD_CONFLICT", "Hisob o‘zgargan. Hisobingizga qayta kiring.");
    });
    clearSession(res, config);
    res.status(204).end();
  });

  // Reply before account lookup or provider I/O, including for ineligible/missing accounts.
  // Bounded best-effort work, not a durable mail queue. Never claim delivery from HTTP 202.
  let pending = 0;
  async function deliver(emailAddress: string) {
    const token = randomBytes(32).toString("hex");
    const digest = hashResetToken(token);
    const now = new Date();
    let userId: Types.ObjectId | undefined;
    try {
      const user = await User.findOne({ email: emailAddress, active: true, role: { $ne: "super_admin" }, tenantId: { $ne: null } })
        .select("+sessionVersion").maxTimeMS(3_000);
      if (!user || !await Tenant.exists({ _id: user.tenantId, active: true }).maxTimeMS(3_000)) return;
      const admitted = await User.updateOne({
        _id: user._id, active: true, role: user.role, tenantId: user.tenantId,
        sessionVersion: user.sessionVersion,
        $or: [{ passwordResetRequestedAt: { $exists: false } }, { passwordResetRequestedAt: { $lte: new Date(now.getTime() - COOLDOWN_MS) } }],
      }, { $set: { passwordResetHash: digest, passwordResetExpiresAt: new Date(now.getTime() + RESET_MS), passwordResetRequestedAt: now } });
      if (admitted.modifiedCount !== 1) return;
      userId = user._id;
      await email!.sendReset({ to: user.email, resetUrl: resetUrl(config.APP_ORIGIN, token) });
    } catch {
      // Do not log provider exceptions: they may contain the entire request/token.
      console.error(JSON.stringify({ event: "password_recovery_delivery_failed" }));
      if (userId) {
        await User.updateOne({ _id: userId, passwordResetHash: digest }, { $unset: resetFields })
          .catch(() => console.error(JSON.stringify({ event: "password_recovery_cleanup_failed" })));
      }
    }
  }
  const requireEmail = () => {
    if (!email) throw new AppError(503, "RECOVERY_DISABLED", "Parolni email orqali tiklash hozircha mavjud emas. Markaz mas’uliga murojaat qiling.");
  };
  router.post("/forgot-password", limit(5), (req, res) => {
    const input = forgotPasswordSchema.parse(req.body);
    requireEmail();
    res.status(202).json({ message: recoveryMessage });
    if (pending >= 10) return;
    pending++;
    setImmediate(() => { void deliver(input.email).finally(() => { pending--; }); });
  });
  router.post("/reset-password", limit(10), async (req, res) => {
    const input = resetPasswordSchema.parse(req.body);
    requireEmail();
    const digest = hashResetToken(input.token);
    const user = await User.findOne({ passwordResetHash: digest, passwordResetExpiresAt: { $gt: new Date() }, active: true,
      role: { $ne: "super_admin" }, tenantId: { $ne: null } }).select("+passwordHash +sessionVersion");
    if (!user) throw invalidReset();
    if (await bcrypt.compare(input.newPassword, user.passwordHash))
      throw new AppError(400, "PASSWORD_REUSED", "Yangi parol joriy paroldan farq qilishi kerak.");
    const passwordHash = await bcrypt.hash(input.newPassword, 12);
    await mongoose.connection.transaction(async session => {
      await activeTenant(user.tenantId, session);
      const result = await User.updateOne({
        _id: user._id, passwordResetHash: digest, passwordResetExpiresAt: { $gt: new Date() },
        active: true, role: user.role, tenantId: user.tenantId, sessionVersion: user.sessionVersion,
      }, { $set: { passwordHash }, $inc: { sessionVersion: 1 }, $unset: resetFields }, { session });
      if (result.modifiedCount !== 1) throw invalidReset();
    });
    clearSession(res, config);
    res.status(204).end();
  });
  return router;
}
