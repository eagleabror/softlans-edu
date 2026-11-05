import mongoose, { type ClientSession, type Types } from "mongoose";
import { Tenant } from "./models.js";
import { AppError } from "./errors.js";
import { Plan, Subscription, PaymentRequest, SaasAudit, TrialGrant } from "./saas-models.js";

export const DAY_MS = 86400000;
export async function ensureSaasDefaults() {
  // Insert only: operators own configuration after the first migration.
  for (const plan of [
    { name: "Starter", code: "starter", monthlyPriceUZS: 149000, studentLimit: 100, groupLimit: 10 },
    { name: "Standard", code: "standard", monthlyPriceUZS: 299000, studentLimit: 300, groupLimit: 30 },
    { name: "Pro", code: "pro", monthlyPriceUZS: 499000, studentLimit: null, groupLimit: null },
  ]) {
    await Plan.updateOne({ code: plan.code }, { $setOnInsert: { ...plan, features: [], isActive: true } }, { upsert: true }).catch((error) => {
      if (error.code !== 11000) throw error;
    });
  }
}
export async function lockSubscription(tenantId: Types.ObjectId, session: ClientSession) {
  // Every quota creation and subscription mutation writes this same document.
  const tenant = await Tenant.findOneAndUpdate({ _id: tenantId }, { $inc: { subscriptionRevision: 1 } }, { session });
  if (!tenant) throw new AppError(404, "NOT_FOUND", "Markaz topilmadi.");
  return tenant;
}
export function effectiveSubscriptionStatus(subscription: { status: string; periodEnd: Date; trialEnd?: Date | null }, now = new Date()) {
  if (["active", "trialing"].includes(subscription.status)) {
    const end = subscription.status === "trialing" ? subscription.trialEnd ?? subscription.periodEnd : subscription.periodEnd;
    if (end.getTime() <= now.getTime()) return "expired";
  }
  return subscription.status;
}
export function addBillingMonths(date: Date, months: number) {
  // Calendar months in Asia/Tashkent, clamped to the last day of the destination month.
  const shifted = new Date(date.getTime() + 5 * 3600000);
  const day = shifted.getUTCDate();
  shifted.setUTCDate(1);
  shifted.setUTCMonth(shifted.getUTCMonth() + months);
  const last = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0)).getUTCDate();
  shifted.setUTCDate(Math.min(day, last));
  return new Date(shifted.getTime() - 5 * 3600000);
}
type PlanSnapshot = { _id: Types.ObjectId; name: string; code: string; monthlyPriceUZS: number; studentLimit?: number | null; groupLimit?: number | null; features: string[] };
export function snapshotPlan(plan: PlanSnapshot) {
  return { planId: plan._id, planName: plan.name, planCode: plan.code, agreedPriceUZS: plan.monthlyPriceUZS,
    studentLimit: plan.studentLimit ?? null, groupLimit: plan.groupLimit ?? null, features: [...plan.features] };
}
export function subscriptionView(s: InstanceType<typeof Subscription>, now = new Date()) {
  return { id: s._id.toString(), tenantId: s.tenantId.toString(), planId: s.planId.toString(), planName: s.planName, planCode: s.planCode,
    status: effectiveSubscriptionStatus(s, now), periodStart: s.periodStart.toISOString(), periodEnd: s.periodEnd.toISOString(),
    trialStart: s.trialStart?.toISOString() ?? null, trialEnd: s.trialEnd?.toISOString() ?? null, agreedPriceUZS: s.agreedPriceUZS,
    studentLimit: s.studentLimit ?? null, groupLimit: s.groupLimit ?? null, features: s.features,
    pendingPlanId: s.pendingPlanId?.toString() ?? null,
    remainingDays: Math.max(0, Math.ceil(((s.status === "trialing" ? s.trialEnd ?? s.periodEnd : s.periodEnd).getTime() - now.getTime()) / DAY_MS)) };
}
export async function createInitialTrial(tenantId: Types.ObjectId, actorId: Types.ObjectId, session: ClientSession, planId?: string) {
  await lockSubscription(tenantId, session);
  if (await TrialGrant.exists({ tenantId }).session(session))
    throw new AppError(409, "TRIAL_ALREADY_USED", "Bu markaz sinov muddatidan foydalangan.");
  const plan = await Plan.findOneAndUpdate({ ...(planId ? { _id: planId } : { code: "starter" }), isActive: true }, { $inc: { selectionRevision: 1 } }, { session, new: true });
  if (!plan) throw new AppError(503, "TRIAL_PLAN_UNAVAILABLE", "Sinov tarifi sozlanmagan. Platforma ma’muriga murojaat qiling.");
  const now = new Date(), end = new Date(now.getTime() + 14 * DAY_MS);
  const [subscription] = await Subscription.create([{ tenantId, ...snapshotPlan(plan), status: "trialing", periodStart: now, periodEnd: end, trialStart: now, trialEnd: end }], { session });
  await TrialGrant.create([{ tenantId, grantedAt: now }], { session });
  await SaasAudit.create([{ actorId, tenantId, action: "trial", targetId: subscription!._id, reason: "Yangi markaz uchun 14 kunlik sinov", after: subscriptionView(subscription!) }], { session });
  return subscription!;
}
type Command = { action: "assign" | "trial" | "extend" | "change_plan" | "suspend" | "reactivate" | "cancel"; planId?: string; billingPeriod?: number; confirmedPayment?: boolean; reason: string; idempotencyKey?: string };
export async function manageSubscription(tenantId: Types.ObjectId, actorId: Types.ObjectId, input: Command) {
  return mongoose.connection.transaction(async (session) => {
    await lockSubscription(tenantId, session);
    const commandPayload = JSON.stringify([input.action, input.planId ?? null, input.billingPeriod ?? 1, input.confirmedPayment ?? false, input.reason]);
    if (input.idempotencyKey) {
      const prior = await SaasAudit.findOne({ tenantId, commandKey: input.idempotencyKey }).session(session);
      if (prior) {
        if (prior.commandPayload !== commandPayload) throw new AppError(409, "IDEMPOTENCY_CONFLICT", "Bu kalit boshqa amalga tegishli.");
        return prior.after;
      }
    }
    let sub = await Subscription.findOne({ tenantId }).session(session);
    const before = sub ? subscriptionView(sub) : null;
    const now = new Date();
    const months = input.billingPeriod ?? 1;
    if (["assign", "trial", "change_plan"].includes(input.action)) {
      const plan = input.planId ? await Plan.findOne({ _id: input.planId, isActive: true }).session(session) : null;
      if (!plan) throw new AppError(400, "PLAN_REQUIRED", "Faol tarifni tanlang.");
      if (input.action === "change_plan") {
        if (!sub) throw new AppError(404, "NOT_FOUND", "Obuna topilmadi.");
        sub.pendingPlanId = plan._id;
      } else {
        if (sub && ["active", "trialing", "suspended"].includes(effectiveSubscriptionStatus(sub, now)) && sub.periodEnd > now)
          throw new AppError(409, "PAID_PERIOD_EXISTS", "Amaldagi davr saqlanadi. Keyingi to‘lov uchun tarifni almashtiring.");
        if (input.action === "trial" && (await TrialGrant.exists({ tenantId }).session(session) || sub?.trialStart))
          throw new AppError(409, "TRIAL_ALREADY_USED", "Bu markaz sinov muddatidan foydalangan.");
        const trial = input.action === "trial";
        const end = trial ? new Date(now.getTime() + 14 * DAY_MS) : input.confirmedPayment ? addBillingMonths(now, months) : now;
        const values = { ...snapshotPlan(plan), status: trial ? "trialing" : input.confirmedPayment ? "active" : "past_due", periodStart: now, periodEnd: end, pendingPlanId: null };
        if (sub) sub.set(values); else sub = new Subscription({ tenantId, ...values });
        if (trial) {
          sub.trialStart = now; sub.trialEnd = end;
          await TrialGrant.create([{ tenantId, grantedAt: now }], { session });
        }
      }
    } else {
      if (!sub) throw new AppError(404, "NOT_FOUND", "Obuna topilmadi.");
      if (input.action === "extend") {
        if (!input.confirmedPayment) throw new AppError(400, "PAYMENT_CONFIRMATION_REQUIRED", "Haqiqiy to‘lov tekshirilganini tasdiqlang.");
        if (["suspended", "cancelled"].includes(sub.status)) throw new AppError(409, "SUBSCRIPTION_INACTIVE", "To‘xtatilgan obunani avval qayta faollashtiring yoki yangi tarif biriktiring.");
        const start = sub.status === "active" && sub.periodEnd > now ? sub.periodEnd : now;
        if (sub.status !== "active" || sub.periodEnd <= now) sub.periodStart = now;
        sub.periodEnd = addBillingMonths(start, months); sub.status = "active";
      } else if (input.action === "reactivate") {
        if (sub.status !== "suspended" || sub.periodEnd <= now) throw new AppError(409, "RENEWAL_REQUIRED", "Amaldagi davr yo‘q. To‘lov tasdiqlangandan keyin obunani yangilang.");
        sub.status = sub.trialEnd && sub.trialEnd.getTime() === sub.periodEnd.getTime() ? "trialing" : "active";
      } else if (input.action === "suspend") sub.status = "suspended";
      else sub.status = "cancelled";
    }
    await sub!.save({ session });
    const after = subscriptionView(sub!);
    await SaasAudit.create([{ actorId, tenantId, targetId: sub!._id, action: input.action, reason: input.reason, before, after,
      ...(input.idempotencyKey ? { commandKey: input.idempotencyKey, commandPayload } : {}) }], { session });
    return after;
  });
}

export async function reviewPayment(id: Types.ObjectId, actorId: Types.ObjectId, approved: boolean, reviewNote: string) {
  return mongoose.connection.transaction(async (session) => {
    // Find tenant first, then serialize even distinct requests for the same tenant.
    const initial = await PaymentRequest.findById(id).session(session);
    if (!initial) throw new AppError(404, "NOT_FOUND", "To‘lov so‘rovi topilmadi.");
    await lockSubscription(initial.tenantId, session);
    const payment = await PaymentRequest.findById(id).session(session);
    if (payment!.status !== "pending") {
      if (payment!.status === (approved ? "approved" : "rejected")) return payment!;
      throw new AppError(409, "PAYMENT_ALREADY_REVIEWED", "Bu so‘rov avval ko‘rib chiqilgan.");
    }
    let before = null, after = null;
    if (approved) {
      let sub = await Subscription.findOne({ tenantId: payment!.tenantId }).session(session);
      const now = new Date();
      before = sub ? subscriptionView(sub) : null;
      // Do not silently discard prepaid time or change the price of a paid period.
      if (sub?.status === "active" && sub.periodEnd > now &&
          (!sub.planId.equals(payment!.planId) || sub.agreedPriceUZS !== payment!.monthlyPriceUZS || sub.studentLimit !== payment!.studentLimit || sub.groupLimit !== payment!.groupLimit))
        throw new AppError(409, "PAID_PERIOD_CONFLICT", "Amaldagi to‘langan davr boshqa shartlarda. Davr tugagach yangi tarif to‘lovini tasdiqlang.");
      if (sub && ["suspended", "cancelled"].includes(sub.status))
        throw new AppError(409, "SUBSCRIPTION_INACTIVE", "To‘xtatilgan yoki bekor qilingan obunani avval boshqaring.");
      const start = sub?.status === "active" && sub.periodEnd > now ? sub.periodEnd : now;
      const values = { planId: payment!.planId, planName: payment!.planName, planCode: payment!.planCode,
        agreedPriceUZS: payment!.monthlyPriceUZS, studentLimit: payment!.studentLimit, groupLimit: payment!.groupLimit,
        features: payment!.features, status: "active", periodEnd: addBillingMonths(start, payment!.billingPeriod), pendingPlanId: null };
      if (sub) {
        if (sub.status !== "active" || sub.periodEnd <= now) sub.periodStart = now;
        sub.set(values);
      } else sub = new Subscription({ tenantId: payment!.tenantId, ...values, periodStart: now });
      await sub.save({ session }); after = subscriptionView(sub);
    }
    payment!.status = approved ? "approved" : "rejected";
    payment!.reviewedBy = actorId; payment!.reviewedAt = new Date(); payment!.reviewNote = reviewNote;
    await payment!.save({ session });
    await SaasAudit.create([{ actorId, tenantId: payment!.tenantId, targetId: payment!._id, action: approved ? "payment_approved" : "payment_rejected", reason: reviewNote || "To‘lov tekshirildi", before, after }], { session });
    return payment!;
  });
}
