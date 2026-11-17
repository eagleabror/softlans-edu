import mongoose, { type ClientSession, type Types } from "mongoose";
import { Plan, Subscription, SaasAudit } from "./saas-models.js";
import { PaymentOrder, PaymentProvider, type Order } from "./payment-models.js";
import { addBillingMonths, lockSubscription, subscriptionView } from "./saas-service.js";
import { AppError } from "./errors.js";
import type { Config } from "./config.js";
import { openPaymentSecret } from "./payment-crypto.js";

export const ORDER_LIFETIME = 12 * 60 * 60_000;
export const gatewayBinding = (p: { _id: Types.ObjectId; provider: string; environment: string }) => `${p._id}:${p.provider}:${p.environment}`;
export function orderView(o: Order) {
  return { id: o._id.toString(), tenantId: o.tenantId.toString(), planId: o.planId.toString(), planName: o.planName,
    provider: o.provider, environment: o.environment, amountUZS: o.amountUZS, billingPeriod: o.billingPeriod,
    status: o.status === "pending" && o.expiresAt <= new Date() ? "expired" : o.status,
    createdAt: o.createdAt.toISOString(), expiresAt: o.expiresAt.toISOString(), paidAt: o.paidAt?.toISOString() ?? null,
    refundedAt: o.refundedAt?.toISOString() ?? null, refundResolvedAt: o.refundResolvedAt?.toISOString() ?? null,
    needsReview: Boolean(o.fulfillmentError) && !o.refundResolvedAt };
}
export async function assertOrderCompatible(o: Order, session: ClientSession) {
  const sub = await Subscription.findOne({ tenantId: o.tenantId }).session(session);
  if (sub && ["suspended", "cancelled"].includes(sub.status))
    throw new AppError(409, "SUBSCRIPTION_INACTIVE", "Obunani avval Super administrator qayta faollashtirishi kerak.");
  if (sub?.status === "active" && sub.periodEnd > new Date() &&
    (!sub.planId.equals(o.planId) || sub.agreedPriceUZS !== o.monthlyPriceUZS || sub.studentLimit !== o.studentLimit || sub.groupLimit !== o.groupLimit || JSON.stringify(sub.features) !== JSON.stringify(o.features)))
    throw new AppError(409, "PAID_PERIOD_CONFLICT", "Amaldagi davr tugagach boshqa tarifga o‘tish mumkin.");
  return sub;
}
export async function createPaymentOrder(input: { planId: string; billingPeriod: number; provider: "payme" | "click"; idempotencyKey: string }, tenantId: Types.ObjectId, actorId: Types.ObjectId, environment: "test" | "production", config: Config) {
  return mongoose.connection.transaction(async session => {
    const prior = await PaymentOrder.findOne({ tenantId, idempotencyKey: input.idempotencyKey }).session(session);
    if (prior) {
      if (!prior.planId.equals(input.planId) || prior.billingPeriod !== input.billingPeriod || prior.provider !== input.provider || prior.environment !== environment)
        throw new AppError(409, "IDEMPOTENCY_CONFLICT", "Bu kalit boshqa to‘lovga tegishli.");
      return prior;
    }
    const gateway = await PaymentProvider.findOneAndUpdate({ provider: input.provider, environment, enabled: true },
      { $set: { used: true }, $inc: { activityRevision: 1 } }, { session, new: true }).select("+secret");
    if (!gateway) throw new AppError(503, "PROVIDER_UNAVAILABLE", "To‘lov tizimi hozircha yoqilmagan.");
    openPaymentSecret(gateway.secret, gatewayBinding(gateway), config);
    // Match the callback lock order (gateway, then tenant) to avoid deadlocks.
    await lockSubscription(tenantId, session);
    const plan = await Plan.findOneAndUpdate({ _id: input.planId, isActive: true }, { $inc: { selectionRevision: 1 } }, { session, new: true });
    if (!plan) throw new AppError(404, "PLAN_NOT_FOUND", "Faol tarif topilmadi.");
    const sub = await Subscription.findOne({ tenantId }).session(session);
    const retain = sub?.status === "active" && sub.periodEnd > new Date() && sub.planId.equals(plan._id);
    const snapshot = retain ? { planName: sub.planName, planCode: sub.planCode, monthlyPriceUZS: sub.agreedPriceUZS, studentLimit: sub.studentLimit, groupLimit: sub.groupLimit, features: sub.features }
      : { planName: plan.name, planCode: plan.code, monthlyPriceUZS: plan.monthlyPriceUZS, studentLimit: plan.studentLimit, groupLimit: plan.groupLimit, features: plan.features };
    const amountUZS = snapshot.monthlyPriceUZS * input.billingPeriod;
    if (amountUZS <= 0 || !Number.isSafeInteger(amountUZS * 100)) throw new AppError(400, "INVALID_AMOUNT", "Bu summa uchun onlayn to‘lov yaratilmaydi.");
    const order = new PaymentOrder({ ...input, ...snapshot, tenantId, submittedBy: actorId, gatewayId: gateway._id, environment, amountUZS, expiresAt: new Date(Date.now() + ORDER_LIFETIME) });
    await assertOrderCompatible(order, session);
    await order.save({ session });
    return order;
  });
}
export async function checkoutUrl(o: Order, config: Config) {
  if (o.status !== "pending" || o.expiresAt <= new Date()) return null;
  const gateway = await PaymentProvider.findById(o.gatewayId);
  if (!gateway?.enabled) return null;
  const back = `${config.APP_ORIGIN}${o.environment === "test" ? "/super-admin/online-payments" : "/settings/subscription"}?paymentOrder=${o._id}`;
  if (o.provider === "payme") {
    const params = `m=${gateway.merchantId};ac.order_id=${o._id};a=${o.amountUZS * 100};l=uz;c=${back}`;
    return `https://${o.environment === "test" ? "test.paycom.uz" : "checkout.paycom.uz"}/${Buffer.from(params).toString("base64")}`;
  }
  const url = new URL("https://my.click.uz/services/pay");
  url.search = new URLSearchParams({ service_id: gateway.serviceId, merchant_id: gateway.merchantId, amount: String(o.amountUZS), transaction_param: o._id.toString(), return_url: back }).toString();
  return url.toString();
}
export async function settleOrder(o: Order, session: ClientSession) {
  if (o.status !== "pending") throw new AppError(409, "ORDER_CLOSED", "To‘lov buyurtmasi yopilgan.");
  let sub = await assertOrderCompatible(o, session);
  const now = new Date();
  if (o.environment === "production") {
    o.subscriptionBefore = sub ? subscriptionView(sub) : null;
    const start = sub?.status === "active" && sub.periodEnd > now ? sub.periodEnd : now;
    const values = { planId: o.planId, planName: o.planName, planCode: o.planCode, agreedPriceUZS: o.monthlyPriceUZS,
      studentLimit: o.studentLimit, groupLimit: o.groupLimit, features: o.features, status: "active", pendingPlanId: null,
      periodEnd: addBillingMonths(start, o.billingPeriod) };
    if (sub) { if (sub.status !== "active" || sub.periodEnd <= now) sub.periodStart = now; sub.set(values); }
    else sub = new Subscription({ tenantId: o.tenantId, ...values, periodStart: now });
    await sub.save({ session }); o.subscriptionAfter = subscriptionView(sub);
  }
  o.status = "paid"; o.paidAt = now;
  await o.save({ session });
  await SaasAudit.create([{ actorId: o.submittedBy, tenantId: o.tenantId, targetId: o._id, action: "online_payment_paid",
    reason: `${o.provider} · ${o.environment}`, before: o.subscriptionBefore, after: o.subscriptionAfter }], { session });
}
export async function cancelOrder(o: Order, session: ClientSession) {
  const paid = o.status === "paid";
  o.status = paid ? "refunded" : "cancelled";
  if (paid) o.refundedAt = new Date();
  await o.save({ session });
  await SaasAudit.create([{ actorId: o.submittedBy, tenantId: o.tenantId, targetId: o._id,
    action: paid ? "online_payment_refunded" : "online_payment_cancelled", reason: `${o.provider} · ${o.environment}` }], { session });
}
