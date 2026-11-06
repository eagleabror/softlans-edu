import { chromium } from './redesign/node_modules/playwright/index.mjs';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createApp } from '../apps/api/src/app.js';
import { parseConfig } from '../apps/api/src/config.js';
import { connectDatabase } from '../apps/api/src/db.js';
import { ensureIndexes, Tenant, User } from '../apps/api/src/models.js';
import { totp, unseal } from '../apps/api/src/mfa-crypto.js';

// Real local API + disposable replica set. No external URI or production secret is read.
const root = 'artifacts/mfa-security';
for (const device of ['desktop', 'mobile']) mkdirSync(`${root}/${device}`, { recursive: true });
const repl = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: '7.0.24' } });
const origin = 'http://localhost:5173';
const config = parseConfig({ NODE_ENV: 'test', APP_ORIGIN: origin, MONGODB_URI: repl.getUri('mfa_screenshots_disposable'),
  JWT_SECRET: randomBytes(48).toString('hex'), MFA_ENCRYPTION_KEY: randomBytes(32).toString('hex') });
await connectDatabase(config.MONGODB_URI); await ensureIndexes();
const server = createApp(config, { frontendDist: resolve('apps/web/dist') }).listen(5173, '127.0.0.1');
await new Promise<void>(r => server.once('listening', r));
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const entries: {device: string; state: string; file: string}[] = [];
const password = 'Synthetic-mfa-browser-password!';
try {
for (const [device, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]] as const) {
  const tenant = await Tenant.create({ name: 'Kelajak Academy · Sinov' });
  const email = `${device}@mfa-ui.test`;
  const user = await User.create({ name: 'Aziz Sinov', email, passwordHash: await bcrypt.hash(password, 12), role: 'business_owner', tenantId: tenant._id });
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
  const page = await context.newPage(); const errors: string[] = [];
  page.on('pageerror', () => errors.push('Browser error'));
  async function shot(state: string) {
    await page.evaluate(() => document.fonts.ready);
    for (const checkWidth of [320, 375, 390, 700, 701, 768, 1024, 1440]) {
      await page.setViewportSize({ width: checkWidth, height });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `Overflow: ${state} at ${checkWidth}`);
    }
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    const file = `${device}/${state}.png`;
    // Never write QR images, recovery codes, or entered factor codes to screenshot artifacts.
    await page.screenshot({ path: `${root}/${file}`, fullPage: true,
      mask: [page.locator('[data-security-secret]'), page.locator('input[name="code"]'), page.locator('input[type="password"]')], maskColor: '#263e35' });
    entries.push({ device, state, file });
  }
  async function login() {
    await page.goto(`${origin}/login`);
    await page.getByLabel('Email manzili').fill(email); await page.getByLabel('Parol', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Hisobga kirish' }).click();
  }
  await login(); await page.waitForURL(`${origin}/`);
  await page.goto(`${origin}/account/security`);
  await page.getByRole('button', { name: 'Himoyani yoqish' }).waitFor(); await shot('security-settings');
  await page.getByRole('button', { name: 'Himoyani yoqish' }).click();
  assert.equal(await page.getByLabel('Joriy parol', { exact: true }).evaluate(el => el === document.activeElement), true);
  await shot('enable-2fa');
  await page.getByLabel('Joriy parol', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Tasdiqlash', exact: true }).click();
  await page.getByRole('heading', { name: 'QR-kod orqali ulash' }).waitFor(); await shot('qr-enrollment');
  const stored = await User.findById(user._id).select('+mfaPendingSecret');
  const secret = unseal(stored!.mfaPendingSecret!, user.id, config);
  await page.getByRole('button', { name: 'Kodni kiritish' }).click(); await shot('verify-authenticator');
  await page.getByLabel('Joriy parol', { exact: true }).fill(password); await page.getByLabel('Tasdiqlash kodi', { exact: true }).fill(totp(secret).generate());
  const enrollment = page.waitForResponse(r => r.url().endsWith('/security/confirm') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Tasdiqlash', exact: true }).click();
  const enrollmentResponse = await enrollment; assert.equal(enrollmentResponse.status(), 200);
  const codes: string[] = (await enrollmentResponse.json()).recoveryCodes;
  await page.getByRole('heading', { name: 'Tiklash kodlari', exact: true }).waitFor(); await shot('recovery-codes');
  await page.getByRole('button', { name: 'Kodlarni saqladim' }).click();
  assert.equal(await page.locator('[data-security-secret]').count(), 0);
  // A second real MFA login creates an independently revocable device session.
  const second = await browser.newContext({ userAgent: 'Synthetic Android Chrome/130' });
  assert.equal((await second.request.post(`${origin}/api/auth/login`, { headers: { Origin: origin }, data: { email, password } })).status(), 200);
  assert.equal((await second.request.post(`${origin}/api/auth/mfa/verify`, { headers: { Origin: origin }, data: { code: codes[0] } })).status(), 200);
  await page.reload(); await page.getByText('Android · Chrome', { exact: true }).waitFor(); await shot('active-sessions');
  const other = page.locator('.mfa-devices li').filter({ hasText: 'Android · Chrome' });
  const opener = other.getByRole('button', { name: 'Sessiyani tugatish' }); await opener.click();
  await page.getByRole('dialog').waitFor(); await shot('revoke-session-confirmation');
  await page.getByRole('button', { name: 'Bekor qilish', exact: true }).click();
  assert.equal(await opener.evaluate(el => el === document.activeElement), true, 'Native dialog restores focus');
  await opener.click(); await page.getByRole('button', { name: 'Ha, tugatish' }).click();
  await page.getByRole('status').filter({ hasText: 'Sessiya tugatildi.' }).waitFor();
  assert.equal((await second.request.get(`${origin}/api/auth/me`)).status(), 401); await second.close();
  await page.getByRole('button', { name: 'Tiklash kodlarini yangilash' }).click(); await shot('regenerate-recovery-codes');
  await page.getByRole('button', { name: 'Yopish', exact: true }).click();
  await page.getByRole('button', { name: 'Boshqa sessiyalarni tugatish' }).click(); await shot('revoke-other-sessions');
  await page.getByRole('button', { name: 'Yopish', exact: true }).click();
  await page.getByRole('button', { name: 'Himoyani o‘chirish' }).click(); await shot('disable-2fa');
  await page.getByRole('button', { name: 'Yopish', exact: true }).click();
  assert.equal((await context.request.post(`${origin}/api/auth/logout`, { headers: { Origin: origin }, data: {} })).status(), 204);
  await login(); await page.getByRole('heading', { name: 'Ikki bosqichli tasdiqlash' }).waitFor(); await shot('mfa-login-challenge');
  await page.getByLabel('Tasdiqlash yoki tiklash kodi').fill(codes[1]!);
  await page.getByRole('button', { name: 'Kirishni tasdiqlash' }).click(); await page.waitForURL(`${origin}/`);
  assert.equal((await context.request.get(`${origin}/api/auth/me`)).status(), 200);
  assert.equal(errors.length, 0); await context.close();
}
writeFileSync(`${root}/manifest.json`, JSON.stringify({ source: 'Real local API + disposable synthetic MongoDB replica set', secretsMasked: true,
  reflowWidths: [320, 375, 390, 700, 701, 768, 1024, 1440], entries }, null, 2) + '\n');
writeFileSync(`${root}/README.md`, '# MFA xavfsizlik skrinshotlari\n\nFaqat sintetik hisoblar va disposable lokal MongoDB ishlatildi. QR-kod, parol va tiklash kodlari niqoblangan.\n\n' +
  entries.map(e => `- [${e.device} · ${e.state}](${e.file})`).join('\n') + '\n');
console.log(`PASS: ${entries.length} masked screenshots; real enrollment, recovery login, session revocation, focus restoration and responsive reflow.`);
} finally {
  await browser.close(); await new Promise<void>(r => server.close(() => r())); await mongoose.disconnect(); await repl.stop();
}
