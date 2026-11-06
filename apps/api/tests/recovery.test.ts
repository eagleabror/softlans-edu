import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, expect, it, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { backupSynthetic, restoreSynthetic, preflight, seal, unseal } from './helpers/recovery.js';
import { connectDatabase } from '../src/db.js';
import { ensureIndexes, Tenant, User, Student } from '../src/models.js';
import { Classroom, Schedule } from '../src/schedule-models.js';
import { Group, Membership } from '../src/group-models.js';
import { LessonSession, AttendanceRecord } from '../src/attendance-models.js';
import { Charge, Payment } from '../src/billing-models.js';
import { Subscription, Plan, PaymentRequest, SaasAudit } from '../src/saas-models.js';
import { TelegramIntegration, TelegramDelivery } from '../src/telegram-models.js';
import { createApp } from '../src/app.js';
import { parseConfig } from '../src/config.js';

const id = randomUUID().replaceAll('-', '');
const target = `dr_restore_${id}`, source = `dr_source_${id}`;
const uri = `mongodb://127.0.0.1:27017/${target}?replicaSet=test`;
it('restore preflight defaults to dry run and rejects unsafe targets and missing approval', () => {
  expect(preflight(uri, target)).toEqual({ dryRun: true });
  for (const name of ['', 'test', 'production', 'softlans', 'softlans-edu', 'softlans_edu', 'dr_restore_'])
    expect(() => preflight(uri, name)).toThrow();
  for (const bad of [uri.replace('127.0.0.1', 'atlas.example.com'), uri.replace(target, 'production'),
    uri.replace('127.0.0.1', 'user:secret@127.0.0.1'), `${uri}&host=remote`, uri.replace('mongodb:', 'mongodb+srv:')])
    expect(() => preflight(bad, target)).toThrow();
  expect(() => preflight(uri, target, undefined, true)).toThrow();
  expect(() => preflight(uri, target, 'yes', true)).toThrow();
});
it('encrypted archives authenticate content and key before restore', () => {
  const key = randomBytes(32), data = Buffer.from('synthetic-only');
  const encrypted = seal(data, key);
  expect(encrypted.includes(data)).toBe(false);
  expect(unseal(encrypted, key)).toEqual(data);
  expect(() => unseal(encrypted, randomBytes(32))).toThrow();
  encrypted[encrypted.length - 1] ^= 1;
  expect(() => unseal(encrypted, key)).toThrow();
});

it.runIf(process.env.DR_DRILL_CONFIRM === 'synthetic-only')('native encrypted backup restores an isolated replica set and application invariants', async () => {
  const repl = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: '7.0.24' } });
  const dir = await mkdtemp(join(tmpdir(), 'softlans-dr-'));
  // All outbound fetch calls fail closed. No server.ts, webhook registration or scheduler process is started.
  const outbound = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('DR outbound disabled'));
  const key = randomBytes(32), path = join(dir, 'synthetic.archive.enc');
  try {
    mongoose.set('autoCreate', false);
    await connectDatabase(repl.getUri(source));
    await ensureIndexes();
    const tenant = await Tenant.create({ name: 'Sintetik A', onboarding: { status: 'in_progress', completedSteps: ['center'], currentStep: 'teacher' } });
    const otherTenant = await Tenant.create({ name: 'Sintetik B' });
    const password = randomBytes(24).toString('hex');
    const passwordHash = await bcrypt.hash(password, 12);
    const actors = [];
    for (const [role, tenantId] of [['business_owner', tenant._id], ['admin', tenant._id], ['teacher', tenant._id], ['business_owner', otherTenant._id]] as const)
      actors.push(await User.create({ name: 'Sintetik', role, tenantId, email: `${randomUUID()}@example.test`, passwordHash }));
    const [owner, admin, teacher, other] = actors;
    const student = await Student.create({ tenantId: tenant._id, firstName: 'Sinov', lastName: 'Oquvchi', createdBy: owner._id });
    const foreignStudent = await Student.create({ tenantId: otherTenant._id, firstName: 'Boshqa', lastName: 'Sinov', createdBy: other._id });
    const group = await Group.create({ tenantId: tenant._id, name: 'Sinov', courseName: 'Fan', teacherId: teacher._id, capacity: 10, monthlyFee: 1000, startDate: '2025-01-01' });
    await Membership.create({ tenantId: tenant._id, groupId: group._id, studentId: student._id, enrolledAt: '2025-01-01' });
    const room = await Classroom.create({ tenantId: tenant._id, name: 'Sinov', nameKey: 'sinov' });
    const schedule = await Schedule.create({ tenantId: tenant._id, groupId: group._id, teacherId: teacher._id, classroomId: room._id, dayOfWeek: 6, startTime: '09:00', endTime: '10:00' });
    const lesson = await LessonSession.create({ tenantId: tenant._id, groupId: group._id, scheduleId: schedule._id, teacherId: teacher._id,
      lessonDate: '2025-02-01', startTime: '09:00', endTime: '10:00', groupName: group.name, roster: [student._id] });
    await AttendanceRecord.create({ tenantId: tenant._id, sessionId: lesson._id, studentId: student._id, status: 'present', markedBy: teacher._id, markedAt: new Date() });
    const charge = await Charge.create({ tenantId: tenant._id, studentId: student._id, groupId: group._id, generatedBy: owner._id,
      billingMonth: '2025-02', originalAmount: 1000, discountAmount: 0, finalAmount: 1000, paidAmount: 400, dueDate: '2025-02-10' });
    await Payment.create({ tenantId: tenant._id, studentId: student._id, chargeId: charge._id, amount: 400, method: 'cash', paidAt: new Date(), recordedBy: admin._id, idempotencyKey: randomUUID(), fingerprint: 'synthetic' });
    const plan = (await Plan.findOne({ code: 'starter' }))!;
    const snapshot = { planId: plan._id, planName: plan.name, planCode: plan.code, studentLimit: plan.studentLimit, groupLimit: plan.groupLimit, features: plan.features };
    await Subscription.create({ ...snapshot, tenantId: tenant._id, status: 'active', periodStart: new Date(), periodEnd: new Date(Date.now() + 86400000), agreedPriceUZS: plan.monthlyPriceUZS });
    const paymentRequest = await PaymentRequest.create({ ...snapshot, tenantId: tenant._id, amountUZS: plan.monthlyPriceUZS, monthlyPriceUZS: plan.monthlyPriceUZS,
      billingPeriod: 1, submittedBy: owner._id, paidAt: new Date(), paymentMethod: 'Bank', transactionNote: 'Sintetik', idempotencyKey: randomUUID() });
    await SaasAudit.create({ actorId: owner._id, tenantId: tenant._id, action: 'payment_requested', targetId: paymentRequest._id, reason: 'Sintetik' });
    const integration = await TelegramIntegration.create({ tenantId: tenant._id, userId: owner._id, status: 'disconnected', notificationPreferences: { enabled: false } });
    await TelegramDelivery.create({ tenantId: tenant._id, userId: owner._id, integrationId: integration._id, integrationRevision: 0, idempotencyKey: randomUUID(), text: 'Sintetik', status: 'cancelled' });
    async function inventory() {
      const db = mongoose.connection.db!;
      const result: Record<string, unknown> = {};
      for (const { name } of await db.listCollections().toArray()) {
        const collection = db.collection(name);
        result[name] = { count: await collection.countDocuments(), indexes: (await collection.listIndexes().toArray()).map(index => ({ ...index, key: Object.entries(index.key) })).sort((a, b) => a.name!.localeCompare(b.name!)),
          documents: await collection.find({}).sort({ _id: 1 }).toArray() };
      }
      return result;
    }
    const before = await inventory();
    // Quiescent fixture source: no concurrent writers; not a live oplog/PITR test.
    await backupSynthetic(repl.getUri(source), source, path, key);
    await mongoose.disconnect();
    await connectDatabase(repl.getUri(target));
    expect(await mongoose.connection.db!.listCollections().toArray()).toHaveLength(0);
    const started = performance.now();
    const confirmation = `RESTORE_SYNTHETIC:${target}`;
    expect(await restoreSynthetic(repl.getUri(target), source, target, path, key)).toEqual({ dryRun: true });
    const valid = await readFile(path), corrupt = Buffer.from(valid); corrupt[corrupt.length - 1] ^= 1;
    await writeFile(path, corrupt);
    await expect(restoreSynthetic(repl.getUri(target), source, target, path, key, confirmation, true)).rejects.toThrow();
    expect(await mongoose.connection.db!.listCollections().toArray()).toHaveLength(0);
    await writeFile(path, valid);
    await restoreSynthetic(repl.getUri(target), source, target, path, key, confirmation, true);
    await expect(restoreSynthetic(repl.getUri(target), source, target, path, key, confirmation, true)).rejects.toThrow('Target bo‘sh');
    expect(await inventory()).toEqual(before); // BEFORE startup can recreate missing indexes
    await ensureIndexes();
    const config = parseConfig({ NODE_ENV: 'test', APP_ORIGIN: 'http://localhost:5173', MONGODB_URI: repl.getUri(target), JWT_SECRET: randomBytes(48).toString('hex') });
    const app = createApp(config);
    expect((await request(app).get('/api/ready')).status).toBe(200);
    const cookies: string[] = [];
    for (const actor of actors) {
      const login = await request(app).post('/api/auth/login').set('Origin', config.APP_ORIGIN).send({ email: actor.email, password });
      expect(login.status).toBe(200); cookies.push(login.headers['set-cookie'][0]);
    }
    const get = (url: string, actor = 0) => request(app).get(url).set('Cookie', cookies[actor]);
    expect((await request(app).get('/api/students')).status).toBe(401);
    expect((await get('/api/students')).body.students.map((s: {id: string}) => s.id)).toEqual([student.id]);
    expect((await get(`/api/students/${foreignStudent.id}`)).status).toBe(404);
    expect((await get(`/api/students/${student.id}`, 3)).status).toBe(404);
    expect((await get('/api/students', 1)).status).toBe(200);
    expect((await get(`/api/attendance/sessions/${lesson.id}/roster`, 2)).status).toBe(200);
    expect((await get('/api/debts', 2)).status).toBe(403);
    expect((await get('/api/debts')).body.charges[0]).toMatchObject({ remainingAmount: 600 });
    expect((await get('/api/debts', 3)).body.total).toBe(0);
    expect((await get('/api/super-admin/saas/plans')).status).toBe(403);
    expect((await Student.findById(student._id))!.tenantId.toString()).toBe(tenant.id);
    expect((await Group.findById(group._id))!.teacherId.toString()).toBe(teacher.id);
    expect((await Subscription.findOne({ tenantId: tenant._id }))!.agreedPriceUZS).toBe(plan.monthlyPriceUZS);
    // Exercise the actual startup entrypoint with a fresh, secret-free environment.
    const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>(resolve => probe.close(() => resolve()));
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
      env: { PATH: process.env.PATH, NODE_ENV: 'test', PORT: String(port), APP_ORIGIN: config.APP_ORIGIN,
        MONGODB_URI: repl.getUri(target), JWT_SECRET: config.JWT_SECRET }, stdio: 'ignore',
    });
    const exited = once(child, 'exit');
    try {
      let ready = false;
      for (let i = 0; i < 100; i++) {
        if (child.exitCode !== null) break;
        try { ready = (await request(`http://127.0.0.1:${port}`).get('/api/ready').timeout(500)).status === 200; } catch {}
        if (ready) break;
        await delay(50);
      }
      expect(ready).toBe(true);
    } finally {
      child.kill('SIGTERM');
      const killTimer = setTimeout(() => child.kill('SIGKILL'), 12000);
      try { expect((await exited)[0]).toBe(0); } finally { clearTimeout(killTimer); }
    }
    expect(outbound).not.toHaveBeenCalled();
    process.stdout.write(JSON.stringify({ drill: 'synthetic-only', collections: Object.keys(before).length,
      recoveryMs: Math.round(performance.now() - started), productionVerified: false }) + '\n');
  } finally {
    outbound.mockRestore(); await mongoose.disconnect(); await repl.stop(); await rm(dir, { recursive: true, force: true }); key.fill(0);
  }
}, 180_000);
afterAll(() => vi.restoreAllMocks());
