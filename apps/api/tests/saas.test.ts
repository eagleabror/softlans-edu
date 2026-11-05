import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import mongoose from "mongoose";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { createApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import { connectDatabase } from "../src/db.js";
import { ensureIndexes, Tenant, User } from "../src/models.js";
import { Plan, Subscription, PaymentRequest, SaasAudit, TrialGrant, SaasSettings } from "../src/saas-models.js";
import { ensureSaasDefaults, createInitialTrial, addBillingMonths } from "../src/saas-service.js";
import { issueToken } from "../src/security.js";
const origin = "http://localhost:5173";
const config = parseConfig({ NODE_ENV:"test",APP_ORIGIN:origin,MONGODB_URI:"mongodb://localhost/test",JWT_SECRET:"s".repeat(48) });
let repl: MongoMemoryReplSet, app: ReturnType<typeof createApp>, tenant: mongoose.Types.ObjectId, uid: mongoose.Types.ObjectId;
let owner: string, sa: string, admin: string, other: string, planId: string;
async function actor(role: string, tenantId: mongoose.Types.ObjectId|null) {
 const u=await User.create({role,tenantId,name:"Sinov",email:`${randomUUID()}@example.test`,passwordHash:"unused"});
 return {id:u._id,cookie:`softlans_session=${issueToken(u,config)}`};
}
const post=(path:string,body:object,cookie=sa)=>request(app).post(path).set("Cookie",cookie).set("Origin",origin).send(body);
const get=(path:string,cookie=sa)=>request(app).get(path).set("Cookie",cookie);
const base="/api/super-admin/saas";
const payment=()=>({planId,billingPeriod:1,paidAt:new Date(Date.now()-1000).toISOString(),paymentMethod:"Bank",transactionNote:"Sinov tranzaksiya",idempotencyKey:randomUUID()});
beforeAll(async()=>{repl=await MongoMemoryReplSet.create({replSet:{count:1},binary:{version:"7.0.24"}});await connectDatabase(repl.getUri("saas_billing_test"));await ensureIndexes();});
beforeEach(async()=>{
 for(const m of [Subscription,PaymentRequest,TrialGrant,User,Tenant,Plan,SaasSettings]) await m.deleteMany({});
 await SaasAudit.collection.deleteMany({});await ensureSaasDefaults();
 tenant=(await Tenant.create({name:"Markaz"}))._id;
 const o=await actor("business_owner",tenant);uid=o.id;owner=o.cookie;
 sa=(await actor("super_admin",null)).cookie;admin=(await actor("admin",tenant)).cookie;
 other=(await actor("business_owner",(await Tenant.create({name:"Boshqa"}))._id)).cookie;
 planId=(await Plan.findOne({code:"starter"}))!._id.toString();app=createApp(config);
 await SaasSettings.create({_id:"platform",approved:true,instructions:"Bank orqali to‘lang"});
});
afterAll(async()=>{await mongoose.disconnect();await repl?.stop();});
it("enforces plan RBAC, validates integer money, edits and deactivates plans",async()=>{
 const body={name:"Yangi",code:"new",monthlyPriceUZS:123000,studentLimit:null,groupLimit:10,features:[],isActive:true};
 expect((await post(`${base}/plans`,body,owner)).status).toBe(403);
 expect((await post(`${base}/plans`,{...body,monthlyPriceUZS:1.2})).status).toBe(400);
 const p=await post(`${base}/plans`,body);expect(p.status).toBe(201);
 const r=await request(app).patch(`${base}/plans/${p.body.plan.id}`).set("Cookie",sa).set("Origin",origin).send({isActive:false});expect(r.status).toBe(200);
 expect((await get('/api/saas/plans',owner)).body.plans.some((p:any)=>p.code==='new')).toBe(false);
});
it("grants one server timed trial and derives expiry without scheduler",async()=>{
 await mongoose.connection.transaction(s=>createInitialTrial(tenant,uid,s));
 const sub=(await Subscription.findOne({tenantId:tenant}))!;
 expect(sub.trialEnd!.getTime()-sub.trialStart!.getTime()).toBe(14*86400000);
 await expect(mongoose.connection.transaction(s=>createInitialTrial(tenant,uid,s))).rejects.toMatchObject({code:"TRIAL_ALREADY_USED"});
 await Subscription.updateOne({_id:sub._id},{$set:{trialEnd:new Date(0),periodEnd:new Date(0)}});
 expect((await get('/api/saas/entitlement',owner)).body).toMatchObject({status:'expired',readOnly:true});
});
it("prices requests on server, isolates tenants, rejects mass assignment and deduplicates",async()=>{
 const body=payment();expect((await post('/api/saas/payment-requests',{...body,amountUZS:1},owner)).status).toBe(400);
 expect((await post('/api/saas/payment-requests',body,admin)).status).toBe(403);
 const r=await post('/api/saas/payment-requests',body,owner);expect(r.status).toBe(201);expect(r.body.request.amountUZS).toBe(149000);
 expect((await post('/api/saas/payment-requests',body,owner)).body.request.id).toBe(r.body.request.id);
 expect((await post('/api/saas/payment-requests',{...body,transactionNote:'O‘zgardi'},owner)).status).toBe(409);
 expect((await get('/api/saas/payment-requests',other)).body.total).toBe(0);
 expect(await Subscription.countDocuments()).toBe(0);
});
it("approves concurrently once, preserves snapshots, audits, and rejects safely",async()=>{
 const r=await post('/api/saas/payment-requests',payment(),owner);const id=r.body.request.id;
 await Plan.updateOne({_id:planId},{$set:{monthlyPriceUZS:999000,studentLimit:1}});
 expect((await post(`${base}/payment-requests/${id}/approve`,{reviewNote:'Bank tekshirildi'},sa)).status).toBe(400);
 const approve=()=>post(`${base}/payment-requests/${id}/approve`,{reviewNote:'Bank tekshirildi',confirmedReceived:true});
 const results=await Promise.all([approve(),approve()]);expect(results.map(r=>r.status)).toEqual([200,200]);
 const sub=(await Subscription.findOne({tenantId:tenant}))!;expect(sub.agreedPriceUZS).toBe(149000);expect(sub.studentLimit).toBe(100);
 const end=sub.periodEnd.getTime();await approve();expect((await Subscription.findById(sub._id))!.periodEnd.getTime()).toBe(end);
 expect(await SaasAudit.countDocuments({action:'payment_approved'})).toBe(1);
 const rejected=await post('/api/saas/payment-requests',payment(),owner);
 expect((await post(`${base}/payment-requests/${rejected.body.request.id}/reject`,{reviewNote:'Pul tushmagan'})).status).toBe(200);
 expect((await Subscription.findById(sub._id))!.periodEnd.getTime()).toBe(end);
 const analytics=(await get(`${base}/analytics`)).body;expect(analytics.mrrUZS).toBe(149000);expect(analytics.approvedAmountUZS).toBe(149000);
});
it("assigns unpaid safely, extends idempotently and excludes trial and expired from MRR",async()=>{
 const path=`${base}/subscriptions/${tenant}`;
 expect((await post(path,{action:'assign',planId,reason:'Tarif biriktirish'})).body.subscription.status).toBe('past_due');
 const input={action:'extend',confirmedPayment:true,billingPeriod:1,reason:'Bank tekshirildi',idempotencyKey:randomUUID()};
 const first=await post(path,input);expect(first.status).toBe(200);const second=await post(path,input);expect(second.body.subscription.periodEnd).toBe(first.body.subscription.periodEnd);
 await Subscription.updateOne({tenantId:tenant},{$set:{periodEnd:new Date(0)}});
 expect((await get(`${base}/analytics`)).body.mrrUZS).toBe(0);
 expect((await post(path,{action:'trial',planId,reason:'Sinov berish'})).status).toBe(200);
 expect((await get(`${base}/analytics`)).body.mrrUZS).toBe(0);
});
it("clamps billing month at Tashkent calendar boundary",()=>{expect(addBillingMonths(new Date('2026-01-31T10:00:00Z'),1).toISOString()).toBe('2026-02-28T10:00:00.000Z');});
