import { listSaasReminders } from "./saas-reminders.js";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import mongoose, { Types } from "mongoose";
import { z } from "zod";
import { Student, Tenant } from "./models.js";
import { Group } from "./group-models.js";
import { AppError } from "./errors.js";
import { principal, requireRoles, tenantScope } from "./security.js";
import { Plan, Subscription, PaymentRequest, SaasAudit, SaasSettings } from "./saas-models.js";
import { effectiveSubscriptionStatus, lockSubscription, manageSubscription, reviewPayment, subscriptionView } from "./saas-service.js";

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const integer = z.number().int().min(0).max(1_000_000_000_000);
const limit = z.number().int().min(0).max(1_000_000).nullable();
const text = (max: number) => z.string().trim().max(max).refine((v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(v));
const planInput = z.object({ name: text(100).min(1), code: z.string().regex(/^[a-z0-9_-]{1,40}$/), monthlyPriceUZS: integer,
  studentLimit: limit, groupLimit: limit, features: z.array(text(200)).max(30), isActive: z.boolean() }).strict();
const page = z.coerce.number().int().min(1).max(10000).default(1);
const status = z.enum(["trialing", "active", "past_due", "expired", "suspended", "cancelled"]);
const pagination = z.object({ page }).strict();
const listPayments = z.object({ page, tenantId: objectId.optional(), status: z.enum(["pending", "approved", "rejected"]).optional(), from: z.string().datetime().optional(), to: z.string().datetime().optional() }).strict();
const commandInput = z.object({ action: z.enum(["assign", "trial", "extend", "change_plan", "suspend", "reactivate", "cancel"]),
  planId: objectId.optional(), billingPeriod: z.number().int().min(1).max(12).optional(), confirmedPayment: z.boolean().optional(), reason: text(500).min(3), idempotencyKey: z.string().uuid().optional() }).strict()
  .refine((v) => !(v.action === "extend" || (v.action === "assign" && v.confirmedPayment)) || !!v.idempotencyKey, "To‘lovni takrorlamaslik kaliti talab qilinadi.");
function id(value: unknown) { return new Types.ObjectId(objectId.parse(value)); }
function limiter(limit: number) { return rateLimit({ windowMs: 60000, limit, keyGenerator: (req) => principal(req).userId.toString(), standardHeaders: "draft-8", legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: { code: "RATE_LIMITED", message: "So‘rovlar soni ko‘p. Birozdan so‘ng qayta urinib ko‘ring." } }) }); }
const planView = (p: InstanceType<typeof Plan>) => ({ id: p._id.toString(), name: p.name, code: p.code, monthlyPriceUZS: p.monthlyPriceUZS,
  studentLimit: p.studentLimit ?? null, groupLimit: p.groupLimit ?? null, features: p.features, isActive: p.isActive });
function paymentView(p: InstanceType<typeof PaymentRequest>, tenantName?: string) {
  return { id: p._id.toString(), tenantId: p.tenantId.toString(), tenantName: tenantName ?? "", planId: p.planId.toString(), planName: p.planName,
    amountUZS: p.amountUZS, billingPeriod: p.billingPeriod, status: p.status, submittedBy: p.submittedBy.toString(), submittedAt: p.submittedAt.toISOString(),
    paidAt: p.paidAt.toISOString(), paymentMethod: p.paymentMethod, transactionNote: p.transactionNote,
    reviewedBy: p.reviewedBy?.toString() ?? null, reviewedAt: p.reviewedAt?.toISOString() ?? null, reviewNote: p.reviewNote };
}
async function paymentList(filter: object, page: number) {
  const [requests, total] = await Promise.all([PaymentRequest.find(filter).sort({ submittedAt: -1, _id: -1 }).skip((page - 1) * 20).limit(20).maxTimeMS(3000), PaymentRequest.countDocuments(filter).maxTimeMS(3000)]);
  const tenants = await Tenant.find({ _id: { $in: requests.map(p => p.tenantId) } }).select("name").maxTimeMS(3000);
  const names = new Map(tenants.map(t => [t._id.toString(), t.name]));
  return { requests: requests.map(p => paymentView(p, names.get(p.tenantId.toString()))), total, page, pageSize: 20 };
}
export const saasRouter = Router();
saasRouter.get("/entitlement", requireRoles("business_owner", "admin", "teacher"), async (req, res) => {
  const sub = await Subscription.findOne(tenantScope(principal(req)));
  const current = sub ? effectiveSubscriptionStatus(sub) : "legacy";
  res.json({ status: current, readOnly: !["active", "trialing", "legacy"].includes(current), periodEnd: sub?.periodEnd.toISOString() ?? null });
});
saasRouter.use(requireRoles("business_owner"), limiter(60));
saasRouter.get("/", async (req, res) => {
  const scope = tenantScope(principal(req));
  const [sub, students, groups, settings] = await Promise.all([Subscription.findOne(scope), Student.countDocuments({ ...scope, status: "active" }), Group.countDocuments({ ...scope, status: "active" }), SaasSettings.findById("platform")]);
  res.json({ subscription: sub ? subscriptionView(sub) : null, legacy: !sub, usage: { students, groups }, instructions: settings?.approved ? { text: settings.instructions, updatedAt: settings.updatedAt.toISOString() } : null });
});
saasRouter.get("/reminders", async (req, res) => res.json({ reminders: await listSaasReminders(tenantScope(principal(req)).tenantId) }));
saasRouter.get("/plans", async (_req, res) => res.json({ plans: (await Plan.find({ isActive: true }).sort({ monthlyPriceUZS: 1, _id: 1 })).map(planView) }));
saasRouter.get("/payment-requests", async (req, res) => res.json(await paymentList(tenantScope(principal(req)), pagination.parse(req.query).page)));
const requestInput = z.object({ planId: objectId, billingPeriod: z.number().int().min(1).max(12), paidAt: z.string().datetime(), paymentMethod: text(100).min(1), transactionNote: text(500).min(1), idempotencyKey: z.string().uuid() }).strict();
saasRouter.post("/payment-requests", limiter(10), async (req, res) => {
  const input = requestInput.parse(req.body), actor = principal(req), scope = tenantScope(actor);
  if (new Date(input.paidAt).getTime() > Date.now()) throw new AppError(400, "INVALID_PAYMENT_DATE", "To‘lov sanasi kelajakda bo‘lishi mumkin emas.");
  const result = await mongoose.connection.transaction(async (session) => {
    await lockSubscription(scope.tenantId, session);
    const existing = await PaymentRequest.findOne({ ...scope, idempotencyKey: input.idempotencyKey }).session(session);
    if (existing) {
      if (!existing.planId.equals(input.planId) || existing.billingPeriod !== input.billingPeriod || existing.paidAt.toISOString() !== input.paidAt || existing.paymentMethod !== input.paymentMethod || existing.transactionNote !== input.transactionNote)
        throw new AppError(409, "IDEMPOTENCY_CONFLICT", "Bu kalit boshqa to‘lov so‘roviga tegishli.");
      return existing;
    }
    const settings = await SaasSettings.findById("platform").session(session);
    if (!settings?.approved || !settings.instructions) throw new AppError(409, "PAYMENT_INSTRUCTIONS_UNAVAILABLE", "To‘lov yo‘riqnomasi hali tasdiqlanmagan.");
    const plan = await Plan.findOne({ _id: input.planId, isActive: true }).session(session);
    if (!plan) throw new AppError(404, "NOT_FOUND", "Faol tarif topilmadi.");
    const sub = await Subscription.findOne(scope).session(session);
    const retain = sub?.status === "active" && sub.periodEnd > new Date() && sub.planId.equals(plan._id);
    const monthlyPriceUZS = retain ? sub!.agreedPriceUZS : plan.monthlyPriceUZS;
    const [payment] = await PaymentRequest.create([{ ...scope, ...input, planId: plan._id, planName: retain ? sub!.planName : plan.name, planCode: retain ? sub!.planCode : plan.code,
      monthlyPriceUZS, amountUZS: monthlyPriceUZS * input.billingPeriod,
      studentLimit: retain ? sub!.studentLimit : plan.studentLimit, groupLimit: retain ? sub!.groupLimit : plan.groupLimit, features: retain ? sub!.features : plan.features,
      submittedBy: actor.userId, paidAt: new Date(input.paidAt) }], { session });
    return payment!;
  });
  res.status(201).json({ request: paymentView(result) });
});

export const saasAdminRouter = Router();
saasAdminRouter.use(requireRoles("super_admin"), (req, _res, next) => { if (principal(req).tenantId !== null) throw new AppError(403, "FORBIDDEN", "Platforma hisobi talab qilinadi."); next(); }, limiter(90));
saasAdminRouter.get("/plans", async (_req, res) => res.json({ plans: (await Plan.find().sort({ monthlyPriceUZS: 1, _id: 1 })).map(planView) }));
saasAdminRouter.post("/plans", async (req, res) => {
  const input = planInput.parse(req.body);
  const plan = await mongoose.connection.transaction(async (session) => {
    const [plan] = await Plan.create([input], { session });
    await SaasAudit.create([{ actorId: principal(req).userId, action: "plan_created", targetId: plan!._id, reason: "Tarif yaratildi", after: planView(plan!) }], { session });
    return plan!;
  });
  res.status(201).json({ plan: planView(plan) });
});
saasAdminRouter.patch("/plans/:id", async (req, res) => {
  const input = planInput.partial().refine(v => Object.keys(v).length > 0).parse(req.body), planId = id(req.params.id);
  const plan = await mongoose.connection.transaction(async (session) => {
    const plan = await Plan.findById(planId).session(session);
    if (!plan) throw new AppError(404, "NOT_FOUND", "Tarif topilmadi.");
    const before = planView(plan); plan.set(input); await plan.save({ session });
    await SaasAudit.create([{ actorId: principal(req).userId, action: "plan_updated", targetId: plan._id, reason: "Tarif sozlamalari yangilandi", before, after: planView(plan) }], { session });
    return plan;
  });
  res.json({ plan: planView(plan) });
});
saasAdminRouter.get("/subscriptions", async (req, res) => {
  const input = z.object({ page, tenantId: objectId.optional(), status: status.optional() }).strict().parse(req.query), now = new Date();
  const filter = { ...(input.tenantId ? { tenantId: id(input.tenantId) } : {}), ...(input.status === "expired" ? { $or: [{ status: "expired" }, { status: { $in: ["active", "trialing"] }, periodEnd: { $lte: now } }] } : input.status ? { status: input.status, ...(["active", "trialing"].includes(input.status) ? { periodEnd: { $gt: now } } : {}) } : {}) };
  const [rows, total] = await Promise.all([Subscription.find(filter).sort({ createdAt: -1, _id: -1 }).skip((input.page - 1) * 20).limit(20).maxTimeMS(3000), Subscription.countDocuments(filter).maxTimeMS(3000)]);
  const tenants = await Tenant.find({ _id: { $in: rows.map(s => s.tenantId) } }).select("name");
  const names = new Map(tenants.map(t => [t._id.toString(), t.name]));
  res.json({ subscriptions: rows.map(s => ({ ...subscriptionView(s), tenantName: names.get(s.tenantId.toString()) ?? "" })), total, page: input.page, pageSize: 20 });
});
saasAdminRouter.post("/subscriptions/:tenantId", limiter(30), async (req, res) => res.json({ subscription: await manageSubscription(id(req.params.tenantId), principal(req).userId, commandInput.parse(req.body)) }));
saasAdminRouter.get("/subscriptions/:tenantId/history", async (req, res) => {
  const tenantId = id(req.params.tenantId), input = pagination.parse(req.query);
  const [entries, total] = await Promise.all([SaasAudit.find({ tenantId }).sort({ createdAt: -1, _id: -1 }).skip((input.page - 1) * 20).limit(20), SaasAudit.countDocuments({ tenantId })]);
  res.json({ entries: entries.map(e => ({ id: e._id.toString(), actorId: e.actorId.toString(), tenantId: e.tenantId!.toString(), action: e.action, reason: e.reason, createdAt: e.createdAt.toISOString(), before: e.before, after: e.after })), total, page: input.page, pageSize: 20 });
});
saasAdminRouter.get("/payment-requests", async (req, res) => {
  const input = listPayments.parse(req.query);
  res.json(await paymentList({ ...(input.tenantId ? { tenantId: id(input.tenantId) } : {}), ...(input.status ? { status: input.status } : {}),
    ...(input.from || input.to ? { submittedAt: { ...(input.from ? { $gte: new Date(input.from) } : {}), ...(input.to ? { $lte: new Date(input.to) } : {}) } } : {}) }, input.page));
});
for (const action of ["approve", "reject"] as const) saasAdminRouter.post(`/payment-requests/:id/${action}`, limiter(30), async (req, res) => {
  const input = action === "approve" ? z.object({ reviewNote: text(500), confirmedReceived: z.literal(true) }).strict().parse(req.body) : z.object({ reviewNote: text(500).min(3) }).strict().parse(req.body);
  res.json({ request: paymentView(await reviewPayment(id(req.params.id), principal(req).userId, action === "approve", input.reviewNote)) });
});
saasAdminRouter.get("/settings", async (_req, res) => {
  const settings = await SaasSettings.findById("platform");
  res.json({ instructions: settings?.instructions ?? "", approved: settings?.approved ?? false, updatedAt: settings?.updatedAt?.toISOString() ?? null });
});
saasAdminRouter.patch("/settings", async (req, res) => {
  const input = z.object({ instructions: text(4000), approved: z.boolean() }).strict().refine(v => !v.approved || v.instructions.length >= 3).parse(req.body);
  const settings = await mongoose.connection.transaction(async (session) => {
    const settings = await SaasSettings.findOneAndUpdate({ _id: "platform" }, { $set: { ...input, approvedBy: input.approved ? principal(req).userId : null, approvedAt: input.approved ? new Date() : null } }, { upsert: true, new: true, session });
    await SaasAudit.create([{ actorId: principal(req).userId, action: "instructions_updated", reason: input.approved ? "To‘lov yo‘riqnomasi tasdiqlandi" : "To‘lov yo‘riqnomasi yopildi" }], { session });
    return settings;
  });
  res.json({ instructions: settings.instructions, approved: settings.approved, updatedAt: settings.updatedAt.toISOString() });
});
saasAdminRouter.get("/analytics", async (_req, res) => {
  const now = new Date();
  const [activePaid, trialing, expired, pendingPayments, income, mrr, byPlan] = await Promise.all([
    Subscription.countDocuments({ status: "active", periodEnd: { $gt: now }, periodStart: { $lte: now }, agreedPriceUZS: { $gt: 0 } }),
    Subscription.countDocuments({ status: "trialing", trialEnd: { $gt: now } }),
    Subscription.countDocuments({ $or: [{ status: "expired" }, { status: { $in: ["active", "trialing"] }, periodEnd: { $lte: now } }] }),
    PaymentRequest.countDocuments({ status: "pending" }),
    PaymentRequest.aggregate([{ $match: { status: "approved" } }, { $group: { _id: null, amount: { $sum: "$amountUZS" } } }]),
    Subscription.aggregate([{ $match: { status: "active", periodEnd: { $gt: now }, periodStart: { $lte: now } } }, { $group: { _id: null, amount: { $sum: "$agreedPriceUZS" } } }]),
    Subscription.aggregate([{ $group: { _id: "$planId", planName: { $first: "$planName" }, count: { $sum: 1 } } }]),
  ]);
  res.json({ activePaid, trialing, expired, pendingPayments, approvedAmountUZS: income[0]?.amount ?? 0, mrrUZS: mrr[0]?.amount ?? 0,
    byPlan: byPlan.map(row => ({ planId: row._id.toString(), planName: row.planName, count: row.count })), generatedAt: now.toISOString() });
});
