import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { createApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import { connectDatabase } from "../src/db.js";
import { ensureIndexes, Tenant, User, Student } from "../src/models.js";
import { Group, Membership } from "../src/group-models.js";
import { Schedule } from "../src/schedule-models.js";
import { Charge, Payment } from "../src/billing-models.js";
import { SalaryPayout } from "../src/payroll-models.js";
import { configuredPasswordEmail } from "../src/password-email.js";

// Never accepts a supplied URI: only this newly created loopback replica set.
// No actual Telegram/email credentials, production records or endpoint calls.
const config = parseConfig({ NODE_ENV: "test", APP_ORIGIN: "http://localhost:5173",
  MONGODB_URI: "mongodb://localhost/unused", JWT_SECRET: randomBytes(48).toString("hex"),
  BILLING_SCHEDULER_SECRET: randomBytes(48).toString("base64url") });
let repl: MongoMemoryReplSet;
const outbound = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Synthetic audit: outbound blocked"));
beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: "7.0.24" } });
  const uri = repl.getUri("phase-6-5-2-synthetic-only");
  expect(uri).toMatch(/^mongodb:\/\/127\.0\.0\.1:/);
  await connectDatabase(uri);
  await ensureIndexes();
});
afterAll(async () => {
  await mongoose.disconnect();
  await repl?.stop();
  outbound.mockRestore();
});

it("recovers a partially committed billing batch, follows >10 tenant cursors and replays without duplicates", async () => {
  let missingOwner: InstanceType<typeof User> | undefined;
  for (let index = 0; index < 11; index++) {
    const tenant = await Tenant.create({ name: `Synthetic readiness ${index}` });
    const owner = await User.create({ tenantId: tenant._id, role: "business_owner", name: "Synthetic owner",
      active: index !== 4, email: randomUUID() + "@example.test", passwordHash: "unused" });
    if (index === 4) missingOwner = owner;
    const teacher = await User.create({ tenantId: tenant._id, role: "teacher", name: "Synthetic teacher",
      email: randomUUID() + "@example.test", passwordHash: "unused" });
    const student = await Student.create({ tenantId: tenant._id, createdBy: owner._id,
      firstName: "Synthetic", lastName: "Fixture", enrollmentDate: "2020-01-01" });
    const group = await Group.create({ tenantId: tenant._id, teacherId: teacher._id, name: "Synthetic group",
      courseName: "Synthetic course", capacity: 10, monthlyFee: 300000, startDate: "2020-01-01" });
    await Membership.create({ tenantId: tenant._id, groupId: group._id, studentId: student._id, enrolledAt: "2020-01-01" });
    await Schedule.create({ tenantId: tenant._id, groupId: group._id, teacherId: teacher._id,
      classroomId: new mongoose.Types.ObjectId(), dayOfWeek: 1, startTime: "10:00", endTime: "11:00" });
  }
  await Tenant.create({ name: "Synthetic inactive excluded", active: false });
  const app = createApp(config);
  const trigger = (after?: string) => request(app).post("/api/internal/billing/run")
    .set("Authorization", `Bearer ${config.BILLING_SCHEDULER_SECRET}`).send(after ? { after } : {});
  const failed = await trigger();
  expect(failed.status).toBe(500);
  expect(await Charge.countDocuments()).toBe(4); // Earlier tenant commits survive the batch error.
  await User.updateOne({ _id: missingOwner!._id }, { $set: { active: true } });
  const first = await trigger();
  expect(first.status).toBe(200);
  expect(first.body).toMatchObject({ created: 6, skipped: 4 });
  expect(first.body.nextCursor).toMatch(/^[a-f\d]{24}$/i);
  const last = await trigger(first.body.nextCursor);
  expect(last.status).toBe(200);
  expect(last.body).toMatchObject({ month: first.body.month, created: 1, skipped: 0, nextCursor: null });
  const concurrent = await Promise.all([trigger(), trigger()]);
  expect(concurrent.map(r => r.status)).toEqual([200, 200]);
  expect(concurrent.map(r => r.body.created)).toEqual([0, 0]);
  expect(await Charge.countDocuments()).toBe(11);
  expect(await Charge.countDocuments({ generationSource: "scheduled", finalAmount: 300000 })).toBe(11);
  expect(await Charge.aggregate([{ $group: { _id: { tenant: "$tenantId", student: "$studentId", group: "$groupId", month: "$billingMonth" }, count: { $sum: 1 } } }, { $match: { count: { $gt: 1 } } }])).toEqual([]);
  expect(await Payment.countDocuments()).toBe(0);
  expect(await SalaryPayout.countDocuments()).toBe(0);
  expect(outbound).not.toHaveBeenCalled();
});

it("fails closed for unverified email and handles rejected/ambiguous gateway outcomes without external delivery", async () => {
  expect(configuredPasswordEmail(config)).toBeUndefined();
  const readyFixture = { ...config, PASSWORD_RECOVERY_ENABLED: true, PASSWORD_EMAIL_DELIVERY_VERIFIED: true,
    PASSWORD_EMAIL_ENDPOINT: "https://synthetic.invalid/send", PASSWORD_EMAIL_API_KEY: "synthetic-".repeat(5), PASSWORD_EMAIL_FROM: "recovery@example.test" };
  expect(configuredPasswordEmail({ ...readyFixture, PASSWORD_EMAIL_DELIVERY_VERIFIED: false })).toBeUndefined();
  const adapter = configuredPasswordEmail(readyFixture)!;
  const message = { to: "synthetic@example.test", resetUrl: "https://synthetic.invalid/reset-password#token=synthetic" };
  for (const status of [302, 400, 401, 403, 429, 500, 503]) {
    outbound.mockResolvedValueOnce(new Response("synthetic-sensitive-body", { status }));
    await expect(adapter.sendReset(message)).rejects.toThrow("Password email gateway rejected delivery");
  }
  for (const error of [new DOMException("synthetic timeout", "TimeoutError"), new TypeError("synthetic redirect or connection failure")]) {
    outbound.mockRejectedValueOnce(error);
    await expect(adapter.sendReset(message)).rejects.toThrow();
  }
  outbound.mockResolvedValueOnce(new Response(null, { status: 202 }));
  await expect(adapter.sendReset(message)).resolves.toBeUndefined(); // Acceptance only, never an inbox assertion.
  expect(outbound).toHaveBeenCalledTimes(10); // No automatic retries after any outcome.
  for (const [url, options] of outbound.mock.calls) {
    expect(url).toBe("https://synthetic.invalid/send");
    expect(options!.redirect).toBe("error");
    expect(options!.signal).toBeInstanceOf(AbortSignal);
  }
});
