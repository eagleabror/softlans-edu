import type { RequestHandler } from "express";
import type { ClientSession, Types } from "mongoose";
import { Student, Tenant } from "./models.js";
import { Group } from "./group-models.js";
import { Subscription } from "./saas-models.js";
import { AppError } from "./errors.js";

const readOnly = () => new AppError(
  402,
  "SUBSCRIPTION_READ_ONLY",
  "Obunangiz faol emas. Ma’lumotlarni ko‘rishingiz mumkin; o‘zgartirish uchun Sozlamalar → Obuna va tariflar bo‘limida obunani yangilang.",
);

/** Evaluate entitlement against server time, never browser dates or scheduler state. */
export async function assertSubscriptionWritable(tenantId: Types.ObjectId, session?: ClientSession) {
  const subscription = await Subscription.findOne({ tenantId }).session(session ?? null);
  // Explicit migration policy: existing tenants keep their access until an administrator
  // assigns a subscription. Registration creates the first trial in its own transaction.
  if (!subscription) return null;
  const now = Date.now();
  const endsAt = subscription.status === "trialing" ? subscription.trialEnd : subscription.periodEnd;
  if (!["active", "trialing"].includes(subscription.status) || !endsAt || endsAt.getTime() <= now)
    throw readOnly();
  return subscription;
}

/** Shared tenant write serializes quotas with other creations and subscription changes.
 * This must be called inside the SAME transaction as the counted resource write. */
export async function assertQuota(
  tenantId: Types.ObjectId,
  kind: "student" | "group",
  increase: number,
  session: ClientSession,
) {
  if (!session.inTransaction()) throw new Error("Quota checks require a transaction");
  if (!Number.isSafeInteger(increase) || increase < 0) throw new Error("Invalid quota increase");
  const tenant = await Tenant.findOneAndUpdate(
    { _id: tenantId, active: true },
    { $inc: { subscriptionRevision: 1 } },
    { session },
  );
  if (!tenant) throw new AppError(404, "NOT_FOUND", "Markaz topilmadi.");
  const subscription = await assertSubscriptionWritable(tenantId, session);
  if (!subscription || increase === 0) return;
  const limit = kind === "student" ? subscription.studentLimit : subscription.groupLimit;
  if (limit == null) return;
  const count = kind === "student"
    ? await Student.countDocuments({ tenantId, status: "active" }).session(session)
    : await Group.countDocuments({ tenantId, status: "active" }).session(session);
  if (count + increase > limit) throw new AppError(
    409,
    "PLAN_LIMIT_REACHED",
    `Tarifdagi faol ${kind === "student" ? "o‘quvchilar" : "guruhlar"} limiti (${limit}) to‘lgan. Mavjud ma’lumotlar saqlanadi. Tarifni yangilang yoki faol yozuvlar sonini kamaytiring.`,
  );
}

/** Run after authentication for every tenant API, including the upload router. */
export const subscriptionEntitlement: RequestHandler = async (req, _res, next) => {
  if (!req.principal?.tenantId || ["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    next();
    return;
  }
  const path = req.originalUrl.split("?")[0]!.toLowerCase().replace(/\/+$/, "");
  // SaaS routes retain their own owner-only RBAC. Auth includes logout and safe
  // account-session operations; no student payment writes are exempted.
  if (/^\/api\/(saas|auth)(\/|$)/.test(path)) {
    next();
    return;
  }
  // Only metadata is exempt. The center endpoint and reused CRM APIs remain gated.
  if (req.method === "PATCH" && path === "/api/onboarding/progress") {
    next();
    return;
  }
  await assertSubscriptionWritable(req.principal.tenantId);
  next();
};
