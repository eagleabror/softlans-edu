import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import request from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import { connectDatabase } from "../src/db.js";
import { ensureIndexes, Tenant, User } from "../src/models.js";
import { DeviceSession } from "../src/security-models.js";
import { Plan, Subscription, SaasAudit, TrialGrant, PaymentRequest, SaasSettings } from "../src/saas-models.js";
import { PaymentProvider, PaymentOrder, GatewayTransaction } from "../src/payment-models.js";
import { createInitialTrial, ensureSaasDefaults, addBillingMonths } from "../src/saas-service.js";
import { createSession } from "../src/security.js";
import { gatewayBinding } from "../src/payment-service.js";
import { openPaymentSecret, sealPaymentSecret } from "../src/payment-crypto.js";
import { clickAmount, clickSignature } from "../src/payment-callbacks.js";
import { newSecret, seal, totp } from "../src/mfa-crypto.js";

const origin = "http://localhost:5173", password = "Payment-testing-only-123!", secret = "synthetic-merchant-secret-123456";
const config = parseConfig({ NODE_ENV: "test", APP_ORIGIN: origin, MONGODB_URI: "mongodb://localhost/test", JWT_SECRET: "s".repeat(48),
  PAYMENT_CREDENTIALS_ENCRYPTION_KEY: "ab".repeat(32), MFA_ENCRYPTION_KEY: "cd".repeat(32) });
let repl: MongoMemoryReplSet, app: ReturnType<typeof createApp>, hash: string;
let tenant: mongoose.Types.ObjectId, ownerId: mongoose.Types.ObjectId, saId: mongoose.Types.ObjectId;
let owner: string, sa: string, admin: string, other: string, planId: string;
const base = "/api/super-admin/saas";
const get = (path: string, cookie = sa) => request(app).get(path).set("Cookie", cookie);
const post = (path: string, body: object, cookie = sa) => request(app).post(path).set("Cookie", cookie).set("Origin", origin).send(body);
const patch = (path: string, body: object, cookie = sa) => request(app).patch(path).set("Cookie", cookie).set("Origin", origin).send(body);
async function actor(role: string, tenantId: mongoose.Types.ObjectId | null) {
  const u = await User.create({ name: "Test", email: `${randomUUID()}@example.test`, role, tenantId, passwordHash: hash });
  return { id: u._id, cookie: `softlans_session=${await createSession(u, config)}` };
}
async function configure(provider: "payme" | "click", environment = "production") {
  const gateway = new PaymentProvider({ provider, environment, merchantId: provider === "payme" ? "a".repeat(24) : "100", serviceId: provider === "click" ? "200" : "", login: "Paycom", enabled: true });
  gateway.secret = sealPaymentSecret(secret, gatewayBinding(gateway), config); await gateway.save(); return gateway;
}
const input = (provider = "payme") => ({ planId, provider, billingPeriod: 1, idempotencyKey: randomUUID() });
async function order(provider = "payme", environment = "production") {
  const res = await post(environment === "test" ? `${base}/payment-orders/test` : "/api/saas/payment-orders", { ...input(provider), ...(environment === "test" ? { tenantId: String(tenant) } : {}) }, environment === "test" ? sa : owner);
  expect(res.status, JSON.stringify(res.body)).toBe(201); return res.body.order;
}
const rpc = (method: string, params: object, environment = "production", key = secret) => request(app).post(`/api/integrations/payme/${environment}`)
  .set("Authorization", `Basic ${Buffer.from(`Paycom:${key}`).toString("base64")}`).send({ jsonrpc: "2.0", id: 1, method, params });
async function pay(id: string, environment = "production") {
  const transactionId = randomUUID(), time = Date.now();
  const created = await rpc("CreateTransaction", { id: transactionId, time, amount: 14900000, account: { order_id: id } }, environment);
  expect(created.body.error, JSON.stringify(created.body)).toBeUndefined();
  const paid = await rpc("PerformTransaction", { id: transactionId }, environment); expect(paid.body.result?.state, JSON.stringify(paid.body)).toBe(2);
  return transactionId;
}
function clickBody(id: string, overrides: Record<string, string> = {}) {
  const body = { click_trans_id: "123456", service_id: "200", click_paydoc_id: "123456", merchant_trans_id: id, amount: "149000.00", action: "0", error: "0", sign_time: "2026-11-17 12:00:00", ...overrides };
  return { ...body, sign_string: clickSignature(body, secret) };
}
const click = (body: object) => request(app).post("/api/integrations/click/production").type("form").send(body);

beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: "7.0.24" } });
  await connectDatabase(repl.getUri("payment_gateways_test")); await ensureIndexes(); hash = await bcrypt.hash(password, 4);
});
beforeEach(async () => {
  for (const model of [GatewayTransaction, PaymentOrder, PaymentProvider, Subscription, TrialGrant, PaymentRequest, SaasSettings, DeviceSession, User, Tenant, Plan]) await model.deleteMany({});
  await SaasAudit.collection.deleteMany({}); await ensureSaasDefaults();
  tenant = (await Tenant.create({ name: "Test center" }))._id;
  const o = await actor("business_owner", tenant); owner = o.cookie; ownerId = o.id;
  const a = await actor("super_admin", null); sa = a.cookie; saId = a.id;
  admin = (await actor("admin", tenant)).cookie;
  other = (await actor("business_owner", (await Tenant.create({ name: "Other" }))._id)).cookie;
  planId = (await Plan.findOne({ code: "starter" }))!._id.toString(); app = createApp(config);
});
afterAll(async () => { await mongoose.disconnect(); await repl?.stop(); });

it("encrypts credentials with random nonces, binds identity and fails closed on wrong keys", () => {
  const a = sealPaymentSecret(secret, "payme:test:id", config), b = sealPaymentSecret(secret, "payme:test:id", config);
  expect(a).not.toBe(b); expect(a).not.toContain(secret); expect(openPaymentSecret(a, "payme:test:id", config)).toBe(secret);
  expect(() => openPaymentSecret(a, "payme:production:id", config)).toThrow();
  expect(() => openPaymentSecret(a, "payme:test:id", { ...config, PAYMENT_CREDENTIALS_ENCRYPTION_KEY: "ef".repeat(32) })).toThrow();
  expect(() => sealPaymentSecret(secret, "id", { ...config, PAYMENT_CREDENTIALS_ENCRYPTION_KEY: undefined })).toThrow();
  expect(clickAmount("149000.00")).toBe(14900000); expect(clickAmount("1e3")).toBeNull(); expect(clickAmount("0.001")).toBeNull();
});
it("requires platform role, Origin and password, returns no secret, retains blank keys and detects stale settings", async () => {
  const path = `${base}/payment-providers/payme/production`, body = { merchantId: "a".repeat(24), login: "Paycom", secret, enabled: true, revision: 0, password };
  expect((await patch(path, body, owner)).status).toBe(403);
  expect((await request(app).patch(path).set("Cookie", sa).send(body)).status).toBe(403);
  expect((await patch(path, { ...body, password: "wrong" })).status).toBe(401);
  const saved = await patch(path, body); expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  expect(JSON.stringify(saved.body)).not.toContain(secret);
  const raw = await PaymentProvider.findOne().select("+secret"); expect(raw!.secret).not.toContain(secret);
  expect(JSON.stringify((await get(`${base}/payment-providers`)).body)).not.toContain(raw!.secret);
  expect((await patch(path, body)).status).toBe(409);
  const { secret: _, ...withoutSecret } = body;
  expect((await patch(path, { ...withoutSecret, enabled: false, revision: 1 })).status).toBe(200);
  expect((await PaymentProvider.findOne().select("+secret"))!.secret).toBe(raw!.secret);
  expect(JSON.stringify(await SaasAudit.find().lean())).not.toContain(secret);
});
it("requires an MFA factor for credential changes and consumes it once", async () => {
  const factor = newSecret();
  await User.updateOne({ _id: saId }, { $set: { mfaEnabled: true, mfaSecret: seal(factor, String(saId), config), mfaLastStep: -1 } });
  const user = await User.findById(saId).select("+sessionVersion"); sa = `softlans_session=${await createSession(user!, config, undefined, true)}`;
  const path = `${base}/payment-providers/payme/test`, body = { merchantId: "a".repeat(24), login: "Paycom", secret, enabled: true, revision: 0, password };
  expect((await patch(path, body)).status).toBe(401);
  const code = totp(factor).generate(); expect((await patch(path, { ...body, code })).status).toBe(200);
  expect((await patch(path, { ...body, code, revision: 1 })).status).toBe(401);
});
it("creates server-priced snapshots, isolates tenants and keeps admin/teacher entitlement access", async () => {
  await configure("payme"); const body = input();
  expect((await post("/api/saas/payment-orders", { ...body, amountUZS: 1 }, owner)).status).toBe(400);
  expect((await post("/api/saas/payment-orders", body, admin)).status).toBe(403);
  expect((await get("/api/saas/entitlement", admin)).status).toBe(200);
  const [created, duplicate] = await Promise.all([post("/api/saas/payment-orders", body, owner), post("/api/saas/payment-orders", body, owner)]);
  expect(created.status).toBe(201); expect(duplicate.status).toBe(201); expect(duplicate.body.order.id).toBe(created.body.order.id); expect(created.body.order.amountUZS).toBe(149000);
  expect(created.body.checkoutUrl).toMatch(/^https:\/\/checkout.paycom.uz\//);
  expect((await post("/api/saas/payment-orders", body, owner)).body.order.id).toBe(created.body.order.id);
  expect((await post("/api/saas/payment-orders", { ...body, billingPeriod: 2 }, owner)).status).toBe(409);
  expect((await get(`/api/saas/payment-orders/${created.body.order.id}`, other)).status).toBe(404);
  expect((await get("/api/saas/payment-orders", other)).body.total).toBe(0);
  expect((await post(`${base}/payment-orders/test`, { ...input(), tenantId: String(tenant) }, owner)).status).toBe(403);
});
it("authenticates Payme, verifies amount, serializes duplicate transactions and survives app restart", async () => {
  await configure("payme"); const o = await order();
  const params = { account: { order_id: o.id }, amount: 14900000 };
  expect((await rpc("CheckPerformTransaction", params, "production", "wrong")).body.error.code).toBe(-32504);
  expect((await rpc("CheckPerformTransaction", { ...params, amount: 1 })).body.error.code).toBe(-31001);
  expect((await rpc("CheckPerformTransaction", params)).body.result.allow).toBe(true);
  const create = { ...params, id: "payme-1", time: Date.now() };
  const made = await Promise.all([rpc("CreateTransaction", create), rpc("CreateTransaction", create)]);
  expect(made[0]!.body).toEqual(made[1]!.body);
  expect((await rpc("CreateTransaction", { ...create, id: "another" })).body.error.code).toBe(-31008);
  await Plan.updateOne({ _id: planId }, { $set: { monthlyPriceUZS: 300000, studentLimit: 5 } });
  const paid = await Promise.all([rpc("PerformTransaction", { id: "payme-1" }), rpc("PerformTransaction", { id: "payme-1" })]);
  expect(paid[0]!.body.result.state).toBe(2); expect(paid[0]!.body).toEqual(paid[1]!.body);
  const sub = (await Subscription.findOne({ tenantId: tenant }))!; expect(sub.agreedPriceUZS).toBe(149000); expect(sub.studentLimit).toBe(100);
  expect(sub.periodEnd).toEqual(addBillingMonths(sub.periodStart, 1));
  app = createApp(config); expect((await rpc("PerformTransaction", { id: "payme-1" })).body).toEqual(paid[0]!.body);
  expect(await SaasAudit.countDocuments({ action: "online_payment_paid" })).toBe(1);
  const statement = await rpc("GetStatement", { from: create.time, to: create.time });
  expect(statement.body.result.transactions).toHaveLength(1); expect(statement.body.result.transactions[0].account.order_id).toBe(o.id);
});
it("test credentials and payments cannot activate real subscriptions or contribute to revenue", async () => {
  await configure("payme", "test");
  const o = await order("payme", "test"); await pay(o.id, "test");
  expect(await Subscription.countDocuments()).toBe(0);
  expect((await get(`${base}/analytics`)).body.onlineAmountUZS).toBe(0);
  expect((await get("/api/saas/payment-orders", owner)).body.total).toBe(0);
  expect((await rpc("CheckPerformTransaction", { account: { order_id: o.id }, amount: 14900000 })).body.error).toBeTruthy();
});
it("keeps callbacks working when disabled and uses a rotated key without redeployment", async () => {
  const gateway = await configure("payme"); const o = await order(); const time = Date.now();
  await rpc("CreateTransaction", { id: "old", time, amount: 14900000, account: { order_id: o.id } });
  const nextSecret = "new-synthetic-merchant-secret";
  const changed = await patch(`${base}/payment-providers/payme/production`, { merchantId: gateway.merchantId, login: "Paycom", secret: nextSecret, enabled: false, revision: 1, password });
  expect(changed.status).toBe(200);
  expect((await post("/api/saas/payment-orders", input(), owner)).status).toBe(503);
  expect((await rpc("PerformTransaction", { id: "old" })).body.error.code).toBe(-32504);
  expect((await rpc("PerformTransaction", { id: "old" }, "production", nextSecret)).body.result.state).toBe(2);
  expect((await patch(`${base}/payment-providers/payme/production`, { merchantId: "b".repeat(24), login: "Paycom", enabled: true, revision: 2, password })).status).toBe(409);
});
it("processes signed Click form callbacks, validates prepare IDs and duplicate completion", async () => {
  await configure("click"); const o = await order("click");
  expect((await click({ ...clickBody(o.id), sign_string: "0".repeat(32) })).body.error).toBe(-1);
  expect((await click(clickBody(o.id, { amount: "149000.01" }))).body.error).toBe(-2);
  expect((await click(clickBody(o.id, { action: "1", merchant_prepare_id: "1" }))).body.error).toBe(-6);
  const prepared = await click(clickBody(o.id)); expect(prepared.body.error, JSON.stringify(prepared.body)).toBe(0); expect(typeof prepared.body.merchant_prepare_id).toBe("number");
  expect((await click(clickBody(o.id))).body).toEqual(prepared.body);
  const body = clickBody(o.id, { action: "1", merchant_prepare_id: String(prepared.body.merchant_prepare_id) });
  const complete = await Promise.all([click(body), click(body)]); expect(complete.map(r => r.body.error).sort()).toEqual([-4, 0]);
  expect((await PaymentOrder.findById(o.id))!.status).toBe("paid"); expect(await SaasAudit.countDocuments({ action: "online_payment_paid" })).toBe(1);
});
it("records already-debited Click money for reversal when subscription conditions change after Prepare", async () => {
  await configure("click"); await mongoose.connection.transaction(s => createInitialTrial(tenant, ownerId, s));
  const o = await order("click"), prepared = await click(clickBody(o.id)); expect(prepared.body.error).toBe(0);
  const sub = (await Subscription.findOne({ tenantId: tenant }))!;
  await Subscription.updateOne({ _id: sub._id }, { $set: { status: "suspended" } });
  const body = clickBody(o.id, { action: "1", merchant_prepare_id: String(prepared.body.merchant_prepare_id) });
  expect((await click(body)).body.error).toBe(0);
  expect((await click(body)).body.error).toBe(-4);
  expect((await get(`/api/saas/payment-orders/${o.id}`, owner)).body.order).toMatchObject({ status: "paid", needsReview: true });
  const current = (await Subscription.findById(sub._id))!; expect(current.status).toBe("suspended"); expect(current.periodEnd).toEqual(sub.periodEnd);
  expect(await SaasAudit.countDocuments({ action: "online_payment_needs_review" })).toBe(1);
});
it("cancels Click failures without granting access and rejects late success for a cancelled payment", async () => {
  await configure("click"); const o = await order("click"), prepared = await click(clickBody(o.id));
  const complete = { action: "1", merchant_prepare_id: String(prepared.body.merchant_prepare_id) };
  expect((await click(clickBody(o.id, { ...complete, error: "-501" }))).body.error).toBe(-9);
  expect((await click(clickBody(o.id, complete))).body.error).toBe(-9);
  expect((await PaymentOrder.findById(o.id))!.status).toBe("cancelled"); expect(await Subscription.countDocuments()).toBe(0);
});
it("serializes a bank approval and an online payment without losing either paid period", async () => {
  await configure("payme"); await SaasSettings.create({ _id: "platform", approved: true, instructions: "Test bank instruction" });
  const manual = await post("/api/saas/payment-requests", { planId, billingPeriod: 1, paidAt: new Date(Date.now() - 1000).toISOString(), paymentMethod: "Bank", transactionNote: "Test bank payment", idempotencyKey: randomUUID() }, owner);
  expect(manual.status).toBe(201); const o = await order();
  const [, review] = await Promise.all([pay(o.id), post(`${base}/payment-requests/${manual.body.request.id}/approve`, { confirmedReceived: true, reviewNote: "Bank independently verified" })]);
  expect(review.status).toBe(200);
  const sub = (await Subscription.findOne({ tenantId: tenant }))!;
  expect(sub.periodEnd).toEqual(addBillingMonths(addBillingMonths(sub.periodStart, 1), 1));
});
it("rejects incompatible plan changes and suspended subscriptions before taking payment", async () => {
  await configure("payme"); await pay((await order()).id);
  const pro = (await Plan.findOne({ code: "pro" }))!;
  expect((await post("/api/saas/payment-orders", { ...input(), planId: String(pro._id) }, owner)).status).toBe(409);
  const o = await order(); await Subscription.updateOne({ tenantId: tenant }, { $set: { status: "suspended" } });
  expect((await rpc("CheckPerformTransaction", { account: { order_id: o.id }, amount: 14900000 })).body.error.code).toBe(-31008);
  expect((await post("/api/saas/payment-orders", input(), owner)).status).toBe(409);
});
it("starts paid access immediately during trial and extends existing time with concurrent distinct payments", async () => {
  await configure("payme"); await mongoose.connection.transaction(s => createInitialTrial(tenant, ownerId, s));
  const o = await order(); await pay(o.id);
  const first = (await Subscription.findOne({ tenantId: tenant }))!; expect(first.status).toBe("active"); expect(first.periodEnd).toEqual(addBillingMonths(first.periodStart, 1));
  const a = await order(), b = await order(); await Promise.all([pay(a.id), pay(b.id)]);
  const after = (await Subscription.findOne({ tenantId: tenant }))!; expect(after.periodEnd).toEqual(addBillingMonths(addBillingMonths(first.periodEnd, 1), 1));
});
it("cancels unperformed transactions, times out Payme reservations and cannot subsequently perform them", async () => {
  await configure("payme"); const o = await order();
  await rpc("CreateTransaction", { id: "expire", time: Date.now(), amount: 14900000, account: { order_id: o.id } });
  await GatewayTransaction.updateOne({ providerId: "expire" }, { $set: { providerTime: Date.now() - 43200001 } });
  expect((await rpc("PerformTransaction", { id: "expire" })).body.error.code).toBe(-31008);
  expect((await rpc("CheckTransaction", { id: "expire" })).body.result).toMatchObject({ state: -1, reason: 4 });
  expect((await PaymentOrder.findById(o.id))!.status).toBe("cancelled"); expect(await Subscription.countDocuments()).toBe(0);
});
it("records refunds without overwriting newer payments and requires revision-checked admin correction", async () => {
  await configure("payme"); const o = await order(); const tx = await pay(o.id);
  const second = await order(); await pay(second.id);
  const end = (await Subscription.findOne({ tenantId: tenant }))!.periodEnd;
  const cancelled = await rpc("CancelTransaction", { id: tx, reason: 5 }); expect(cancelled.body.result.state).toBe(-2);
  expect((await rpc("CancelTransaction", { id: tx, reason: 5 })).body).toEqual(cancelled.body);
  expect((await Subscription.findOne({ tenantId: tenant }))!.periodEnd).toEqual(end);
  const detail = (await get(`${base}/online-payments/${o.id}`)).body;
  const body = { password, confirmedRefund: true, reference: "refund-test-123", reason: "Provayder kabinetida tekshirildi", periodEnd: detail.after.periodEnd, subscriptionRevision: detail.subscriptionRevision };
  expect((await post(`${base}/online-payments/${o.id}/refund`, { ...body, subscriptionRevision: 0 })).status).toBe(409);
  expect((await post(`${base}/online-payments/${o.id}/refund`, body)).status).toBe(200);
  expect((await post(`${base}/online-payments/${o.id}/refund`, body)).status).toBe(200);
  expect(await SaasAudit.countDocuments({ action: "online_refund_reconciled" })).toBe(1);
  const totals = (await get(`${base}/analytics`)).body; expect(totals.onlineAmountUZS).toBe(149000); expect(totals.refundedAmountUZS).toBe(149000);
});
