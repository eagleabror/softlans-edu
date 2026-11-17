import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { Types } from "mongoose";
import { z } from "zod";
import type { Config } from "./config.js";
import { principal, requireRoles, tenantScope } from "./security.js";
import { verifiedSecurityMutation } from "./mfa-security.js";
import { PaymentProvider, PaymentOrder } from "./payment-models.js";
import { openPaymentSecret, sealPaymentSecret } from "./payment-crypto.js";
import { checkoutUrl, createPaymentOrder, gatewayBinding, orderView } from "./payment-service.js";
import { AppError } from "./errors.js";
import { SaasAudit, Subscription } from "./saas-models.js";
import { Tenant } from "./models.js";
import { lockSubscription, subscriptionView } from "./saas-service.js";

const provider = z.enum(["payme", "click"]), environment = z.enum(["test", "production"]);
const objectId = z.string().regex(/^[a-f0-9]{24}$/i);
const orderInput = z.object({ planId: objectId, billingPeriod: z.number().int().min(1).max(12), provider, idempotencyKey: z.string().uuid() }).strict();
const pagination = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1) }).strict();
const proof = { password: z.string().min(1).max(72), code: z.string().max(64).optional() };
const identifier = z.string().trim().regex(/^[A-Za-z0-9_-]{1,100}$/);
const settingsInput = z.object({ merchantId: identifier, serviceId: z.string().regex(/^\d{1,30}$/).optional(), login: identifier.optional(),
  secret: z.string().min(8).max(256).regex(/^[\x21-\x7e]+$/).optional(), enabled: z.boolean(), revision: z.number().int().min(0), ...proof }).strict();
const limiter = () => rateLimit({ windowMs: 60_000, limit: 60, keyGenerator: req => principal(req).userId.toString(), standardHeaders: "draft-8", legacyHeaders: false });
function providerView(p: InstanceType<typeof PaymentProvider>, config: Config) {
  return { provider: p.provider, environment: p.environment, merchantId: p.merchantId, serviceId: p.serviceId, login: p.login,
    secretConfigured: true, enabled: p.enabled, revision: p.revision, used: p.used, lastCallbackAt: p.lastCallbackAt?.toISOString() ?? null,
    lastError: p.lastError, callbackUrl: `${config.APP_ORIGIN}/api/integrations/${p.provider}/${p.environment}` };
}
async function listOrders(filter: object, page: number) {
  const [rows, total] = await Promise.all([PaymentOrder.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * 20).limit(20), PaymentOrder.countDocuments(filter)]);
  return { orders: rows.map(orderView), total, page, pageSize: 20 };
}
export function paymentOwnerRouter(config: Config) {
  const router = Router();
  router.use(["/payment-orders", "/payment-providers"], requireRoles("business_owner"), limiter());
  router.get("/payment-providers", async (_req, res) => {
    const rows = config.PAYMENT_CREDENTIALS_ENCRYPTION_KEY ? await PaymentProvider.find({ environment: "production", enabled: true }).select("+secret") : [];
    const available = rows.filter(p => { try { openPaymentSecret(p.secret, gatewayBinding(p), config); return true; } catch { return false; } });
    res.json({ providers: available.map(p => p.provider) });
  });
  router.post("/payment-orders", async (req, res) => {
    const actor = principal(req), input = orderInput.parse(req.body);
    const order = await createPaymentOrder(input, tenantScope(actor).tenantId, actor.userId, "production", config);
    res.status(201).json({ order: orderView(order), checkoutUrl: await checkoutUrl(order, config) });
  });
  router.get("/payment-orders", async (req, res) => res.json(await listOrders({ ...tenantScope(principal(req)), environment: "production" }, pagination.parse(req.query).page)));
  router.get("/payment-orders/:id", async (req, res) => {
    const order = await PaymentOrder.findOne({ _id: objectId.parse(req.params.id), ...tenantScope(principal(req)), environment: "production" });
    if (!order) throw new AppError(404, "NOT_FOUND", "To‘lov topilmadi.");
    res.json({ order: orderView(order), checkoutUrl: await checkoutUrl(order, config) });
  });
  return router;
}
export function paymentAdminRouter(config: Config) {
  const router = Router();
  router.use(["/payment-providers", "/payment-orders", "/online-payments"], requireRoles("super_admin"), (req, _res, next) => {
    if (principal(req).tenantId !== null) throw new AppError(403, "FORBIDDEN", "Platforma hisobi talab qilinadi.");
    next();
  }, limiter());
  router.get("/payment-providers", async (_req, res) => {
    const rows = await PaymentProvider.find();
    res.json({ encryptionAvailable: Boolean(config.PAYMENT_CREDENTIALS_ENCRYPTION_KEY), providers: rows.map(p => providerView(p, config)), origin: config.APP_ORIGIN });
  });
  router.patch("/payment-providers/:provider/:environment", async (req, res) => {
    const name = provider.parse(req.params.provider), mode = environment.parse(req.params.environment), input = settingsInput.parse(req.body);
    if ((name === "click" && (!input.serviceId || input.login)) || (name === "payme" && (!input.login || input.serviceId)))
      throw new AppError(400, "INVALID_PROVIDER_FIELDS", "Provayder rekvizitlarini tekshiring.");
    const result = await verifiedSecurityMutation(config, req, async (_user, session) => {
      let row = await PaymentProvider.findOne({ provider: name, environment: mode }).select("+secret").session(session);
      if ((row?.revision ?? 0) !== input.revision) throw new AppError(409, "SETTINGS_CHANGED", "Sozlamalar o‘zgargan. Sahifani yangilang.");
      if (row?.used && (row.merchantId !== input.merchantId || row.serviceId !== (input.serviceId ?? "")))
        throw new AppError(409, "MERCHANT_IN_USE", "Ishlatilgan merchant va service ID’ni almashtirib bo‘lmaydi.");
      if (!row && !input.secret) throw new AppError(400, "SECRET_REQUIRED", "Maxfiy kalitni kiriting.");
      row ??= new PaymentProvider({ provider: name, environment: mode, revision: 0 });
      row.set({ merchantId: input.merchantId, serviceId: input.serviceId ?? "", login: input.login ?? "", enabled: input.enabled });
      if (input.secret) row.secret = sealPaymentSecret(input.secret, gatewayBinding(row), config);
      // Also verify existing ciphertext before toggling/retaining it; no silent fallback.
      openPaymentSecret(row.secret, gatewayBinding(row), config);
      row.revision++;
      await row.save({ session });
      await SaasAudit.create([{ actorId: principal(req).userId, targetId: row._id, action: "payment_provider_updated",
        reason: `${name} · ${mode}`, after: { provider: name, environment: mode, revision: row.revision, enabled: row.enabled, secretChanged: Boolean(input.secret) } }], { session });
      return providerView(row, config);
    }, true, true);
    res.json({ provider: result });
  });
  router.post("/payment-orders/test", async (req, res) => {
    const input = orderInput.extend({ tenantId: objectId }).parse(req.body);
    const order = await createPaymentOrder(input, new Types.ObjectId(input.tenantId), principal(req).userId, "test", config);
    res.status(201).json({ order: orderView(order), checkoutUrl: await checkoutUrl(order, config) });
  });
  router.get("/online-payments", async (req, res) => {
    const input = pagination.extend({ environment: environment.optional(), status: z.enum(["pending", "paid", "cancelled", "refunded"]).optional(), tenantId: objectId.optional() }).parse(req.query);
    res.json(await listOrders({ ...(input.environment ? { environment: input.environment } : {}), ...(input.status ? { status: input.status } : {}), ...(input.tenantId ? { tenantId: new Types.ObjectId(input.tenantId) } : {}) }, input.page));
  });
  router.get("/online-payments/:id", async (req, res) => {
    const order = await PaymentOrder.findById(objectId.parse(req.params.id));
    if (!order) throw new AppError(404, "NOT_FOUND", "To‘lov topilmadi.");
    const [tenant, sub] = await Promise.all([Tenant.findById(order.tenantId).select("+subscriptionRevision"), Subscription.findOne({ tenantId: order.tenantId })]);
    res.json({ order: orderView(order), tenantName: tenant?.name ?? "", subscription: sub ? subscriptionView(sub) : null,
      subscriptionRevision: tenant?.subscriptionRevision ?? 0, before: order.subscriptionBefore, after: order.subscriptionAfter, checkoutUrl: await checkoutUrl(order, config) });
  });
  router.post("/online-payments/:id/refund", async (req, res) => {
    const orderId = objectId.parse(req.params.id);
    const input = z.object({ ...proof, confirmedRefund: z.literal(true), reference: z.string().trim().min(3).max(200),
      reason: z.string().trim().min(3).max(500), periodEnd: z.string().datetime(), subscriptionRevision: z.number().int().min(0) }).strict().parse(req.body);
    const result = await verifiedSecurityMutation(config, req, async (user, session) => {
      const initial = await PaymentOrder.findById(orderId).session(session);
      if (!initial) throw new AppError(404, "NOT_FOUND", "To‘lov topilmadi.");
      const tenant = await lockSubscription(initial.tenantId, session);
      const order = (await PaymentOrder.findById(orderId).session(session))!;
      if (order.refundResolvedAt) return orderView(order);
      if (order.environment !== "production" || (order.provider === "payme" ? order.status !== "refunded" : !["paid", "refunded"].includes(order.status)))
        throw new AppError(409, "REFUND_NOT_CONFIRMED", "Qaytarish holatini provayder kabinetida tekshiring. Payme tasdig‘i kelishi kerak.");
      const sub = await Subscription.findOne({ tenantId: order.tenantId }).session(session);
      if (!sub || tenant.subscriptionRevision !== input.subscriptionRevision) throw new AppError(409, "SUBSCRIPTION_CHANGED", "Obuna o‘zgargan. Tafsilotlarni qayta oching.");
      const end = new Date(input.periodEnd);
      if (end > sub.periodEnd || end < sub.periodStart) throw new AppError(400, "INVALID_PERIOD", "Yangi muddat joriy obuna oralig‘ida bo‘lishi kerak.");
      const before = subscriptionView(sub);
      sub.periodEnd = end;
      if (["active", "past_due", "expired"].includes(sub.status)) sub.status = end > new Date() ? "active" : "expired";
      await sub.save({ session });
      order.status = "refunded"; order.refundedAt ??= new Date(); order.refundResolvedAt = new Date(); order.refundReference = input.reference;
      await order.save({ session });
      await SaasAudit.create([{ actorId: user._id, tenantId: order.tenantId, targetId: order._id, action: "online_refund_reconciled", reason: input.reason,
        before, after: { ...subscriptionView(sub), reference: input.reference } }], { session });
      return orderView(order);
    }, true, true);
    res.json({ order: result });
  });
  return router;
}
