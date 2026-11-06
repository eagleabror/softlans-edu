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
import { TestPasswordEmail } from '../apps/api/tests/helpers/password-email.js';

// Real application/API + newly allocated disposable MongoDB + in-memory mailbox.
// Explicit generated configuration ignores external DB URI/provider variables.
const root = 'artifacts/password-security';
mkdirSync(root, { recursive: true });
const repl = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: '7.0.24' } });
const origin = 'http://localhost:5173';
const config = parseConfig({ NODE_ENV: 'test', APP_ORIGIN: origin, MONGODB_URI: repl.getUri('password_screenshots_disposable'), JWT_SECRET: randomBytes(48).toString('hex') });
await connectDatabase(config.MONGODB_URI); await ensureIndexes();
const mailbox = new TestPasswordEmail();
const app = createApp(config, { frontendDist: resolve('apps/web/dist'), testPasswordEmail: mailbox });
const server = app.listen(5173, '127.0.0.1');
await new Promise<void>(r => server.once('listening', r));
const disabledOrigin = 'http://localhost:5174';
const disabledServer = createApp({ ...config, APP_ORIGIN: disabledOrigin }, { frontendDist: resolve('apps/web/dist') }).listen(5174, '127.0.0.1');
await new Promise<void>(r => disabledServer.once('listening', r));
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const manifest: any[] = [];
const original = 'Fictional-current-2026!';
const changed = 'Fictional-changed-2026!';
const resetPass = 'Fictional-reset-2026!';
try {
for (const [device, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]] as const) {
  const tenant = await Tenant.create({ name: 'Kelajak Academy · Sinov' });
  const email = `${device}@password-ui.test`;
  const user = await User.create({ name: 'Aziz Sinov', email, passwordHash: await bcrypt.hash(original, 12), role: 'business_owner', tenantId: tenant._id });
  // A fresh app instance uses the same global API limit, so screenshots stay under budget.
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', () => errors.push('Browser page error'));
  async function shot(name: string) {
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'Horizontal overflow');
    const file = `${device}-${name}.png`;
    await page.screenshot({ path: `${root}/${file}`, fullPage: true });
    manifest.push({ device, state: name, file, overflow: false, pageErrors: errors.length });
  }
  async function fill(next: string, current?: string) {
    if (current) await page.getByLabel('Joriy parol', { exact: true }).fill(current);
    await page.getByLabel('Yangi parol', { exact: true }).fill(next);
    await page.getByLabel('Yangi parolni tasdiqlang', { exact: true }).fill(next);
  }
  await page.goto(`${origin}/login`);
  await page.getByLabel('Email manzili').fill(email); await page.getByLabel('Parol', { exact: true }).fill(original);
  await page.getByRole('button', { name: 'Hisobga kirish' }).click();
  await page.waitForURL(`${origin}/`);
  await page.goto(`${origin}/account/change-password`);
  await page.getByRole('heading', { name: 'Parolni o‘zgartirish' }).waitFor();
  await shot('change-password');
  // Verify reflow at all design-skill target widths using the real rendered form.
  for (const checkWidth of [320, 375, 700, 701, 768, 1024, 1440]) {
    await page.setViewportSize({ width: checkWidth, height });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `Change form overflow at ${checkWidth}`);
  }
  await page.setViewportSize({ width, height });
  await page.getByRole('button', { name: 'Parolni yangilash' }).click();
  await page.getByRole('alert').waitFor(); await shot('change-validation');
  assert.equal(await page.getByLabel('Joriy parol', { exact: true }).evaluate(el => el === document.activeElement), true);
  await fill(changed, original);
  await page.getByRole('button', { name: 'Yangi parol: ko‘rsatish', exact: true }).click();
  assert.equal(await page.getByLabel('Yangi parol', { exact: true }).getAttribute('type'), 'text');
  // Hide before screenshot to keep even fictional passwords out of artifacts.
  await page.getByRole('button', { name: 'Yangi parol: yashirish', exact: true }).click();
  await page.getByRole('button', { name: 'Parolni yangilash' }).click();
  await page.getByRole('status').filter({ hasText: 'Parolingiz yangilandi' }).waitFor();
  await shot('change-success');

  await page.goto(`${origin}/forgot-password`);
  await page.getByRole('button', { name: 'Tiklash havolasini so‘rash', disabled: false }).waitFor();
  await shot('forgot-password');
  await page.getByRole('button', { name: 'Tiklash havolasini so‘rash' }).click();
  await page.getByRole('alert').waitFor(); await shot('forgot-validation');
  await page.getByLabel('Email manzili').fill(email);
  await page.getByRole('button', { name: 'Tiklash havolasini so‘rash' }).click();
  await page.getByRole('status').filter({ hasText: 'Agar hisobingiz' }).waitFor(); await shot('forgot-requested');
  await expectMailbox(email);
  const resetLink = mailbox.messages.find(m => m.to === email)!.resetUrl;
  await page.goto(resetLink);
  await page.getByRole('button', { name: 'Parolni yangilash', disabled: false }).waitFor();
  assert.equal(new URL(page.url()).hash, '');
  await shot('reset-password');
  await page.getByRole('button', { name: 'Parolni yangilash' }).click();
  await page.getByRole('alert').waitFor(); await shot('reset-validation');
  for (const checkWidth of [320, 375, 700, 701, 768, 1024, 1440]) {
    await page.setViewportSize({ width: checkWidth, height });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `Reset form overflow at ${checkWidth}`);
  }
  await page.setViewportSize({ width, height });
  await fill(resetPass);
  await page.getByRole('button', { name: 'Parolni yangilash' }).click();
  await page.getByRole('status').filter({ hasText: 'Parolingiz yangilandi' }).waitFor(); await shot('reset-success');
  // Used-token feedback is returned by the real API, rather than a mocked UI response.
  await page.goto(resetLink); await fill('Fictional-another-2026!');
  await page.getByRole('button', { name: 'Parolni yangilash' }).click();
  await page.getByRole('alert').filter({ hasText: 'Tiklash havolasi yaroqsiz' }).waitFor(); await shot('reset-used-token');
  await page.goto(`${disabledOrigin}/forgot-password`);
  await page.getByRole('alert').filter({ hasText: 'hozircha mavjud emas' }).waitFor(); await shot('forgot-disabled');
  assert.equal(errors.length, 0);
  assert.equal((await User.findById(user._id).select('+sessionVersion'))!.sessionVersion, 2);
  await context.close();
}
writeFileSync(`${root}/manifest.json`, JSON.stringify({ source: 'Real local API, disposable MongoDB, test-only mailbox', entries: manifest, reflowWidths: [320, 375, 390, 700, 701, 768, 1024, 1440] }, null, 2) + '\n');
console.log(`PASS: ${manifest.length} Playwright screenshots; desktop/mobile flows and responsive checks.`);
} finally {
  await browser.close();
  await Promise.all([new Promise<void>(r => server.close(() => r())), new Promise<void>(r => disabledServer.close(() => r()))]);
  await mongoose.disconnect(); await repl.stop();
}
async function expectMailbox(email: string) {
  for (let n = 0; n < 100; n++) {
    if (mailbox.messages.some(m => m.to === email)) return;
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error('Test mailbox did not receive the disposable reset request');
}
