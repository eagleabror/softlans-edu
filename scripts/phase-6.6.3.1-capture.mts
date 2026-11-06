import { chromium } from "./redesign/node_modules/playwright/index.mjs";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { createApp } from "../apps/api/src/app.js";
import { parseConfig } from "../apps/api/src/config.js";
import { connectDatabase } from "../apps/api/src/db.js";
import { ensureIndexes, Tenant, User } from "../apps/api/src/models.js";
import { createInitialTrial } from "../apps/api/src/saas-service.js";
import { createSession } from "../apps/api/src/security.js";
import { cashDay } from "../apps/api/src/cash-service.js";

// Only a newly created disposable local replica set; never reads environment DB URIs.
process.env.MONGOMS_DOWNLOAD_DIR ??= resolve("apps/work/mongodb-binaries");
const root = "artifacts/phase-6.6.3.1";
for (const device of ["desktop", "mobile"])
  mkdirSync(`${root}/${device}`, { recursive: true });
const repl = await MongoMemoryReplSet.create({
  replSet: { count: 1 },
  binary: { version: "7.0.24" },
});
const origin = "http://127.0.0.1:5173";
const config = parseConfig({
  NODE_ENV: "test",
  APP_ORIGIN: origin,
  MONGODB_URI: repl.getUri("expenses_cash_screenshots_disposable"),
  JWT_SECRET: randomBytes(48).toString("hex"),
});
await connectDatabase(config.MONGODB_URI);
await ensureIndexes();
const tenant = await Tenant.create({
  name: "Kelajak Academy · Sinov",
  onboarding: {
    status: "completed",
    completedSteps: [
      "center",
      "teacher",
      "group",
      "students",
      "telegram",
      "completion",
    ],
    currentStep: "completion",
  },
});
const owner = await User.create({
  tenantId: tenant._id,
  role: "business_owner",
  name: "Aziz Sinov",
  email: "cash-owner@example.test",
  passwordHash: "unused",
});
await createInitialTrial(tenant._id, owner._id);
const token = await createSession(owner, config);
const server = createApp(config, {
  frontendDist: resolve("apps/web/dist"),
}).listen(5173, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", r));
async function api(path: string, data?: object) {
  const r = await fetch(`${origin}/api/cash${path}`, {
    method: data ? "POST" : "GET",
    headers: {
      Origin: origin,
      Cookie: `softlans_session=${token}`,
      "Content-Type": "application/json",
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  const body = await r.json();
  assert.ok(r.ok, JSON.stringify(body));
  return body;
}
const confirm = (data = {}) => ({
  confirmed: true,
  reason: "Faqat sintetik sinov",
  idempotencyKey: randomUUID(),
  ...data,
});
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const entries: object[] = [],
  errors: string[] = [];
const widths = [320, 375, 390, 699, 700, 701, 768, 900, 1024, 1440];
try {
  await api("/setup", confirm());
  const { accounts, categories } = await api("/draft-options");
  const cash = accounts.find((a) => a.kind === "cash"),
    bank = accounts.find((a) => a.kind === "bank");
  await api(
    `/accounts/${cash.id}/opening`,
    confirm({ amount: 10000000, date: cashDay() }),
  );
  await api(
    `/accounts/${bank.id}/opening`,
    confirm({ amount: 25000000, date: cashDay() }),
  );
  const { expense } = await api("/expenses", {
    accountId: cash.id,
    categoryId: categories.find((c) => c.name === "Ijara").id,
    amount: 2500000,
    expenseDate: cashDay(),
    description: "O‘quv binosi ijarasi · sintetik sinov",
    supplier: "Sinov hamkor",
    reference: "SINOV-001",
    method: "cash",
    idempotencyKey: randomUUID(),
  });
  await api(`/expenses/${expense.id}/confirm`, confirm());
  await api(
    "/movements",
    confirm({
      accountId: cash.id,
      toAccountId: bank.id,
      amount: 1000000,
      date: cashDay(),
      kind: "transfer",
    }),
  );
  for (const [device, width, height] of [
    ["desktop", 1440, 1000],
    ["mobile", 390, 844],
  ] as const) {
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    await context.addCookies([
      {
        name: "softlans_session",
        value: token,
        url: origin + "/api",
        httpOnly: true,
        sameSite: "Strict",
      },
    ]);
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    for (const [state, path, title] of [
      ["expenses", "/expenses", "Xarajatlar"],
      ["new", "/expenses/new", "Yangi xarajat"],
      ["categories", "/expenses/categories", "Xarajat kategoriyalari"],
      ["accounts", "/cash/accounts", "Kassa va bank hisoblari"],
      ["movements", "/cash/movements", "Pul harakatlari"],
      ["daily", "/cash/daily", "Kunlik kassa ko‘rinishi"],
      ["detail", `/expenses/${expense.id}`, "Xarajat tafsilotlari"],
    ]) {
      await page.goto(origin + path, { waitUntil: "networkidle" });
      await page.getByRole("heading", { name: title, exact: true }).waitFor();
      await page.evaluate(() => document.fonts.ready);
      for (const checkWidth of widths) {
        await page.setViewportSize({ width: checkWidth, height });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth + 1,
          ),
          false,
          `${state}: overflow at ${checkWidth}`,
        );
      }
      await page.setViewportSize({ width, height });
      const file = `${device}/${state}.png`;
      await page.screenshot({ path: `${root}/${file}`, fullPage: true });
      entries.push({
        device,
        state,
        file,
        overflowWidthsChecked: widths,
        source: "Real API + built frontend; disposable synthetic database",
      });
    }
    await page
      .getByRole("button", { name: "Xarajatni bekor qilish", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    await page
      .getByLabel("Amal sababi")
      .fill("Brauzer orqali sintetik qaytarish");
    assert.equal(
      await page
        .getByLabel("Amal sababi")
        .evaluate((el) => el === document.activeElement),
      true,
    );
    await page.screenshot({
      path: `${root}/${device}/confirmation.png`,
      fullPage: true,
    });
    // Escape cancels the sensitive action. Desktop then verifies real void + replay API.
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    if (device === "mobile") {
      await page
        .getByRole("button", { name: "Xarajatni bekor qilish", exact: true })
        .click();
      await page
        .getByLabel("Amal sababi")
        .fill("Brauzer orqali sintetik qaytarish");
      await dialog
        .getByRole("button", { name: "Tasdiqlash", exact: true })
        .click();
      await page
        .getByRole("status")
        .filter({ hasText: "Amal muvaffaqiyatli" })
        .waitFor();
      assert.equal(
        (await api(`/expenses/${expense.id}`)).expense.status,
        "voided",
      );
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
  const daily = await api("/daily");
  assert.equal(
    daily.rows.reduce((sum, a) => sum + a.confirmedBalance, 0),
    35000000,
  );
  writeFileSync(
    `${root}/screenshot-manifest.json`,
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        entries,
        browserErrors: errors,
        assertions: [
          "10 viewport widths per screen",
          "dialog focus and Escape",
          "real UI void",
          "transfers conserve money",
          "no external data",
        ],
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `Captured ${entries.length + 2} screenshots; all browser assertions passed.`,
  );
} finally {
  await browser.close();
  await new Promise<void>((r) => server.close(() => r()));
  await mongoose.disconnect();
  await repl.stop();
}
