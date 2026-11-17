import express, { Router, type Request, type ErrorRequestHandler } from "express";
import mongoose from "mongoose";
import { createHash } from "node:crypto";
import { z, ZodError } from "zod";
import { rateLimit } from "express-rate-limit";
import type { Config } from "./config.js";
import { AppError } from "./errors.js";
import { GatewayTransaction, PaymentOrder, PaymentProvider, type Order } from "./payment-models.js";
import { assertOrderCompatible, cancelOrder, gatewayBinding, ORDER_LIFETIME, settleOrder } from "./payment-service.js";
import { openPaymentSecret, secretMatches } from "./payment-crypto.js";
import { lockSubscription } from "./saas-service.js";
import { SaasAudit } from "./saas-models.js";

class ProtocolError extends Error {
  constructor(public code: number, public data?: string) { super("Payment protocol error"); }
}
const rpcError = (code: number, data?: string) => ({ error: { code, message: { uz: "To‘lov so‘rovini bajarib bo‘lmadi.", ru: "Не удалось выполнить запрос.", en: "Payment request could not be processed." }, ...(data ? { data } : {}) } });
const identifier = z.string().min(1).max(100);
const timestamp = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const accountSchema = z.object({ order_id: z.string().regex(/^[a-f0-9]{24}$/i) }).strict();
type Tx = InstanceType<typeof GatewayTransaction>;
const txView = (tx: Tx) => ({ transaction: tx._id.toString(), create_time: tx.createTime, perform_time: tx.performTime, cancel_time: tx.cancelTime, state: tx.state, reason: tx.reason });
const clickErrorText: Record<number, string> = { 0: "Success", "-1": "SIGN CHECK FAILED", "-2": "Incorrect parameter amount", "-3": "Action not found", "-4": "Already paid", "-5": "Order not found", "-6": "Transaction not found", "-7": "Failed to update order", "-8": "Error in request", "-9": "Transaction cancelled" };
const clickValue = z.union([z.string().max(200), z.number().int().safe()]).transform(String);
const clickInput = z.object({ click_trans_id: clickValue, service_id: clickValue, click_paydoc_id: clickValue,
  merchant_trans_id: z.string().regex(/^[a-f0-9]{24}$/i), merchant_prepare_id: clickValue.optional(),
  amount: z.union([z.string(), z.number()]).transform(String), action: clickValue, error: clickValue,
  error_note: z.string().max(500).optional(), sign_time: z.string().min(1).max(100), sign_string: z.string().regex(/^[a-fA-F0-9]{32}$/) });

// Parse decimal UZS exactly, without rounding floats or accepting exponent notation.
export function clickAmount(value: string) {
  if (!/^\d{1,14}(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const tiyins = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
  return tiyins <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(tiyins) : null;
}
export function clickSignature(input: { click_trans_id: string; service_id: string; merchant_trans_id: string; merchant_prepare_id?: string; amount: string; action: string; sign_time: string }, secret: string) {
  return createHash("md5").update(input.click_trans_id + input.service_id + secret + input.merchant_trans_id +
    (input.action === "1" ? input.merchant_prepare_id ?? "" : "") + input.amount + input.action + input.sign_time).digest("hex");
}

export function paymentCallbacks(config: Config, provider: "payme" | "click") {
  const router = Router();
  router.use(rateLimit({ windowMs: 60_000, limit: 3000, standardHeaders: "draft-8", legacyHeaders: false }));
  router.use(express.json({ limit: "16kb" }), express.urlencoded({ extended: false, limit: "16kb", parameterLimit: 30 }));
  router.post("/:environment", async (req, res) => {
    let authenticatedGateway: string | undefined;
    let response: Record<string, unknown>;
    const rpcId = typeof req.body?.id === "string" || typeof req.body?.id === "number" ? req.body.id : null;
    try {
      const environment = z.enum(["test", "production"]).parse(req.params.environment);
      response = await mongoose.connection.transaction(async session => {
        const gateway = await PaymentProvider.findOne({ provider, environment }).select("+secret").session(session);
        if (!gateway) throw new ProtocolError(provider === "payme" ? -32504 : -1);
        const secret = openPaymentSecret(gateway.secret, gatewayBinding(gateway), config);
        if (provider === "payme") {
          const expected = `Basic ${Buffer.from(`${gateway.login}:${secret}`).toString("base64")}`;
          if (!secretMatches(req.get("Authorization") ?? "", expected)) throw new ProtocolError(-32504);
        } else {
          const input = clickInput.parse(req.body);
          if (!["0", "1"].includes(input.action)) throw new ProtocolError(-3);
          if (input.service_id !== gateway.serviceId || !secretMatches(input.sign_string.toLowerCase(), clickSignature(input, secret))) throw new ProtocolError(-1);
        }
        authenticatedGateway = gateway._id.toString();
        // Serialize callback processing with key rotation and settings changes.
        await PaymentProvider.updateOne({ _id: gateway._id }, { $inc: { activityRevision: 1 } }, { session });
        if (provider === "payme") {
          const request = z.object({ method: z.string(), params: z.record(z.string(), z.unknown()), id: z.union([z.string(), z.number(), z.null()]).optional(), jsonrpc: z.literal("2.0").optional() }).parse(req.body);
          const p = request.params;
          if (request.method === "GetStatement") {
            const from = timestamp.parse(p.from), to = timestamp.parse(p.to);
            if (to < from) throw new ProtocolError(-32602);
            const rows = await GatewayTransaction.find({ gatewayId: gateway._id, providerTime: { $gte: from, $lte: to } }).sort({ providerTime: 1, _id: 1 }).session(session).maxTimeMS(5000);
            return { result: { transactions: rows.map(tx => ({ ...txView(tx), id: tx.providerId, time: tx.providerTime, amount: tx.amountUZS * 100, account: { order_id: tx.orderId.toString() } })) } };
          }
          const creating = ["CheckPerformTransaction", "CreateTransaction"].includes(request.method);
          if (!["CheckPerformTransaction", "CreateTransaction", "PerformTransaction", "CancelTransaction", "CheckTransaction"].includes(request.method)) throw new ProtocolError(-32601);
          let tx = request.method !== "CheckPerformTransaction" ? await GatewayTransaction.findOne({ gatewayId: gateway._id, providerId: identifier.parse(p.id) }).session(session) : null;
          let order: Order | null;
          if (creating) {
            const parsedAccount = accountSchema.safeParse(p.account);
            if (!parsedAccount.success) throw new ProtocolError(-31050, "order_id");
            order = await PaymentOrder.findOne({ _id: parsedAccount.data.order_id, gatewayId: gateway._id }).session(session);
            if (!order) throw new ProtocolError(-31050, "order_id");
            if (p.amount !== order.amountUZS * 100) throw new ProtocolError(-31001);
          } else {
            if (!tx) throw new ProtocolError(-31003);
            order = await PaymentOrder.findById(tx.orderId).session(session);
            if (!order) throw new ProtocolError(-31050, "order_id");
          }
          await lockSubscription(order.tenantId, session);
          // Mongo transactions retry on the tenant/gateway write conflict, including stale reads.
          if (tx && creating && (!tx.orderId.equals(order._id) || tx.amountUZS * 100 !== p.amount || tx.providerTime !== p.time)) throw new ProtocolError(-31008);
          if (tx?.state === 1 && tx.providerTime + ORDER_LIFETIME <= Date.now()) {
            tx.state = -1; tx.reason = 4; tx.cancelTime = Date.now(); await tx.save({ session });
            await cancelOrder(order, session);
          }
          if (request.method === "CheckTransaction") return { result: txView(tx!) };
          if (request.method === "CancelTransaction") {
            const reason = z.number().int().min(1).max(10).parse(p.reason);
            if (tx!.state > 0) {
              tx!.state = tx!.state === 2 ? -2 : -1; tx!.reason = reason; tx!.cancelTime = Date.now();
              await tx!.save({ session }); await cancelOrder(order, session);
            }
            return { result: { transaction: tx!._id.toString(), cancel_time: tx!.cancelTime, state: tx!.state } };
          }
          if (request.method === "PerformTransaction") {
            if (tx!.state === 2) return { result: { transaction: tx!._id.toString(), perform_time: tx!.performTime, state: 2 } };
            if (tx!.state !== 1) return rpcError(-31008);
            await settleOrder(order, session); tx!.state = 2; tx!.performTime = Date.now(); await tx!.save({ session });
            return { result: { transaction: tx!._id.toString(), perform_time: tx!.performTime, state: 2 } };
          }
          if (tx) return tx.state === 1 ? { result: { transaction: tx._id.toString(), create_time: tx.createTime, state: 1 } } : rpcError(-31008);
          if (order.status !== "pending" || order.expiresAt <= new Date() || await GatewayTransaction.exists({ orderId: order._id }).session(session)) throw new ProtocolError(-31008);
          await assertOrderCompatible(order, session);
          if (request.method === "CheckPerformTransaction") return { result: { allow: true } };
          const time = timestamp.parse(p.time);
          if (time + ORDER_LIFETIME <= Date.now() || time > Date.now() + 60_000) throw new ProtocolError(-31008);
          const [created] = await GatewayTransaction.create([{ gatewayId: gateway._id, orderId: order._id, providerId: identifier.parse(p.id), providerTime: time, createTime: Date.now(), amountUZS: order.amountUZS }], { session });
          // The provider transaction now owns its documented 12-hour lifetime.
          order.expiresAt = new Date(time + ORDER_LIFETIME); await order.save({ session });
          return { result: { transaction: created!._id.toString(), create_time: created!.createTime, state: 1 } };
        }
        const input = clickInput.parse(req.body);
        const order = await PaymentOrder.findOne({ _id: input.merchant_trans_id, gatewayId: gateway._id }).session(session);
        if (!order) throw new ProtocolError(-5);
        if (clickAmount(input.amount) !== order.amountUZS * 100) throw new ProtocolError(-2);
        await lockSubscription(order.tenantId, session);
        let tx = await GatewayTransaction.findOne({ gatewayId: gateway._id, providerId: input.click_trans_id }).session(session);
        if (tx && !tx.orderId.equals(order._id)) throw new ProtocolError(-8);
        const reply = (tx: Tx, code = 0) => ({ click_trans_id: input.click_trans_id, merchant_trans_id: order._id.toString(),
          ...(input.action === "0" ? { merchant_prepare_id: tx.clickPrepareId } : { merchant_confirm_id: tx.clickPrepareId }), error: code, error_note: clickErrorText[code] });
        if (input.action === "0") {
          if (tx) return reply(tx, tx.state === 1 ? 0 : tx.state === 2 ? -4 : -9);
          if (order.status !== "pending") throw new ProtocolError(order.status === "paid" ? -4 : -9);
          if (order.expiresAt <= new Date() || await GatewayTransaction.exists({ orderId: order._id }).session(session)) throw new ProtocolError(-9);
          if (input.error !== "0") throw new ProtocolError(-8);
          await assertOrderCompatible(order, session);
          const sequence = await PaymentProvider.findByIdAndUpdate(gateway._id, { $inc: { merchantSequence: 1 } }, { session, new: true });
          const [created] = await GatewayTransaction.create([{ gatewayId: gateway._id, orderId: order._id, providerId: input.click_trans_id, clickPrepareId: sequence!.merchantSequence, providerTime: Date.now(), createTime: Date.now(), amountUZS: order.amountUZS }], { session });
          return reply(created!);
        }
        if (!tx || input.merchant_prepare_id !== String(tx.clickPrepareId)) throw new ProtocolError(-6);
        if (tx.state === 2) return reply(tx, -4);
        if (tx.state < 0) return reply(tx, -9);
        if (!/^-?\d+$/.test(input.error)) throw new ProtocolError(-8);
        if (Number(input.error) < 0) {
          tx.state = -1; tx.cancelTime = Date.now(); tx.reason = Number(input.error);
          await tx.save({ session }); await cancelOrder(order, session); return reply(tx, -9);
        }
        if (input.error !== "0") throw new ProtocolError(-8);
        // A prepared Click transaction may complete after the checkout link expires.
        try {
          await settleOrder(order, session);
        } catch (error) {
          // Click has already debited the customer before Complete. A business
          // conflict must not masquerade as unpaid or overwrite an admin change.
          // The operator reverses the payment in Click and reconciles it in the UI.
          if (!(error instanceof AppError) || error.status !== 409) throw error;
          order.status = "paid"; order.paidAt = new Date(); order.fulfillmentError = error.code;
          await order.save({ session });
          await SaasAudit.create([{ actorId: order.submittedBy, tenantId: order.tenantId, targetId: order._id,
            action: "online_payment_needs_review", reason: `click · ${order.environment} · ${error.code}` }], { session });
        }
        tx.state = 2; tx.performTime = Date.now(); await tx.save({ session });
        return reply(tx);
      });
    } catch (error) {
      const code = error instanceof ProtocolError ? error.code : error instanceof ZodError ? (provider === "payme" ? -32602 : -8)
        : error instanceof AppError && error.status === 409 ? (provider === "payme" ? -31008 : -7) : provider === "payme" ? -32400 : -7;
      response = provider === "payme" ? rpcError(code, error instanceof ProtocolError ? error.data : undefined) : { error: code, error_note: clickErrorText[code] ?? "Request failed" };
    }
    // Operational metadata only; no incoming payload, signature, Authorization or secret is persisted.
    if (authenticatedGateway) {
      const code = typeof response.error === "number" ? response.error : (response.error as { code?: number } | undefined)?.code;
      await PaymentProvider.updateOne({ _id: authenticatedGateway }, { $set: { lastCallbackAt: new Date(), lastError: code ? String(code) : "" } }).catch(() => {});
    }
    res.json(provider === "payme" ? { jsonrpc: "2.0", id: rpcId, ...response } : response);
  });
  const parseError: ErrorRequestHandler = (_error, _req, res, _next) => {
    res.json(provider === "payme" ? { jsonrpc: "2.0", id: null, ...rpcError(-32700) } : { error: -8, error_note: clickErrorText[-8] });
  };
  router.use(parseError);
  return router;
}
