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
import { Charge, Payment } from "../apps/api/src/billing-models.js";
import { Payroll, SalaryPayout } from "../apps/api/src/payroll-models.js";
import {
  CashAccount,
  CashMovement,
  ExpenseCategory,
  Expense,
} from "../apps/api/src/cash-models.js";
import { Group } from "../apps/api/src/group-models.js";
function reportDates(months: number, last = false) {
  const today = cashDay(),
    d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  if (last) {
    const end = new Date(+d - 86400000).toISOString().slice(0, 10);
    d.setUTCMonth(d.getUTCMonth() - 1);
    return { start: d.toISOString().slice(0, 10), end };
  }
  d.setUTCMonth(d.getUTCMonth() - months + 1);
  return { start: d.toISOString().slice(0, 10), end: today };
}

// Never reads environment MONGODB_URI. Fresh local synthetic replica set only.
async function main() {
  const root = "artifacts/phase-6.6.3.2";
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
    MONGODB_URI: repl.getUri("profit_loss_screenshots_disposable"),
    JWT_SECRET: randomBytes(48).toString("hex"),
  });
  await connectDatabase(config.MONGODB_URI);
  await ensureIndexes();
  const tenant = await Tenant.create({
    name: "Kelajak Academy · Sintetik",
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
    email: "report-owner@example.test",
    passwordHash: "unused",
  });
  await createInitialTrial(tenant._id, owner._id);
  const token = await createSession(owner, config);
  const dates = reportDates(6),
    today = cashDay(),
    first = dates.start;
  const category = await ExpenseCategory.create({
    tenantId: tenant._id,
    createdBy: owner._id,
    name: "Ijara",
    accountingClassification: "operating",
  });
  const accounts = await CashAccount.create([
    {
      tenantId: tenant._id,
      createdBy: owner._id,
      name: "Naqd kassa",
      kind: "cash",
      openingDate: first,
    },
    {
      tenantId: tenant._id,
      createdBy: owner._id,
      name: "Bank hisobi",
      kind: "bank",
      openingDate: first,
    },
  ]);
  async function move(
    kind: string,
    delta: number,
    date: string,
    sourceId: string,
    index = 0,
  ) {
    await CashMovement.create({
      tenantId: tenant._id,
      recordedBy: owner._id,
      accountId: accounts[index]!._id,
      kind,
      delta,
      date,
      sourceId,
      reason: "Faqat sintetik tekshiruv",
    });
  }
  await move("opening", 10000000, first, accounts[0]!.id);
  await move("opening", 25000000, first, accounts[1]!.id, 1);
  // Use existing group model with its required fields; synthetic data only.
  const group = await Group.create({
    tenantId: tenant._id,
    teacherId: owner._id,
    name: "Ingliz tili · B2",
    courseName: "Ingliz tili",
    startDate: new Date(first),
    monthlyFee: 1000000,
    capacity: 20,
  });
  let month = first.slice(0, 7),
    index = 0;
  while (month <= today.slice(0, 7)) {
    const day = `${month}-01`,
      billed = 12000000 + index * 500000,
      received = billed - 2000000;
    const c = await Charge.create({
      tenantId: tenant._id,
      generatedBy: owner._id,
      studentId: new mongoose.Types.ObjectId(),
      groupId: group._id,
      billingMonth: month,
      originalAmount: billed + 500000,
      prorationAmount: 500000,
      finalAmount: billed,
      dueDate: new Date(`${day}T00:00:00+05:00`),
    });
    const p = await Payment.create({
      tenantId: tenant._id,
      studentId: c.studentId,
      chargeId: c._id,
      recordedBy: owner._id,
      amount: received,
      method: "cash",
      paidAt: new Date(`${day}T09:00:00+05:00`),
      idempotencyKey: randomUUID(),
      fingerprint: "synthetic",
    });
    await move("payment", received, day, p.id);
    const payroll = await Payroll.create({
      tenantId: tenant._id,
      teacherId: owner._id,
      createdBy: owner._id,
      payrollMonth: month,
      calculationBasis: {},
      grossSalary: 4000000,
      finalSalary: 4000000,
      status: "partially_paid",
      approvedAt: new Date(),
      calculatedAt: new Date(),
    });
    const payout = await SalaryPayout.create({
      tenantId: tenant._id,
      payrollId: payroll._id,
      recordedBy: owner._id,
      amount: 3000000,
      method: "cash",
      paidAt: new Date(`${day}T09:00:00+05:00`),
      idempotencyKey: randomUUID(),
      fingerprint: "synthetic",
    });
    await move("salary", -3000000, day, payout.id);
    const e = await Expense.create({
      tenantId: tenant._id,
      createdBy: owner._id,
      amount: 2500000,
      categoryId: category._id,
      categoryName: "Ijara",
      accountingClassification: "operating",
      accountId: accounts[0]!._id,
      description: "O‘quv binosi · sintetik ijara",
      expenseDate: day,
      method: "cash",
      status: "confirmed",
    });
    await move("expense", -e.amount, day, e.id);
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + 1);
    month = d.toISOString().slice(0, 7);
    index++;
  }
  const transfer = randomUUID();
  await move("transfer", -1000000, today, transfer);
  await move("transfer", 1000000, today, transfer, 1);
  await move("manual_in", 750000, today, randomUUID());
  const unallocatedCharge = await Charge.findOne({ tenantId: tenant._id });
  await Payment.create({
    tenantId: tenant._id,
    studentId: unallocatedCharge!.studentId,
    chargeId: unallocatedCharge!._id,
    recordedBy: owner._id,
    amount: 100000,
    method: "cash",
    paidAt: new Date(),
    idempotencyKey: randomUUID(),
    fingerprint: "synthetic",
  });
  const server = createApp(config, {
    frontendDist: resolve("apps/web/dist"),
  }).listen(5173, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const errors: string[] = [],
    entries: object[] = [];
  try {
    for (const [device, width, height] of [
      ["desktop", 1440, 1100],
      ["mobile", 390, 844],
    ] as const) {
      const context = await browser.newContext({
        viewport: { width, height },
        reducedMotion: "reduce",
        acceptDownloads: true,
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
      await page.goto(origin + "/reports/management", {
        waitUntil: "networkidle",
      });
      await page
        .getByRole("heading", { name: "Foyda va pul oqimi", exact: true })
        .waitFor();
      await page.getByText("Naqd kassa", { exact: true }).waitFor();
      const widths = [320, 375, 390, 699, 700, 701, 768, 900, 1024, 1440];
      for (const checkWidth of widths) {
        await page.setViewportSize({ width: checkWidth, height });
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              ),
            ),
        );
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth + 1,
          ),
          false,
          `Page overflow at ${checkWidth}`,
        );
      }
      await page.setViewportSize({ width, height });
      await page.screenshot({
        path: `${root}/${device}/management.png`,
        fullPage: true,
      });
      // Keyboard-accessible chart detail tables and native date filters.
      await page
        .getByText("Jadval ko‘rinishi", { exact: true })
        .first()
        .click();
      await page
        .getByRole("table", {
          name: "Oylik ta’lim haqi va tushum (UZS)",
          exact: true,
        })
        .waitFor();
      const downloadEvent = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "CSV eksport", exact: true })
        .click();
      const download = await downloadEvent;
      assert.equal(await download.failure(), null);
      const responsePromise = page.waitForResponse(
        (r) =>
          r.url().includes("/api/management-reports?") && r.status() === 200,
      );
      await page
        .getByRole("button", { name: "O‘tgan oy", exact: true })
        .click();
      await responsePromise;
      await page.getByText("Naqd kassa", { exact: true }).waitFor();
      await page.screenshot({
        path: `${root}/${device}/previous-month.png`,
        fullPage: true,
      });
      const asOf = await page.getByLabel("Qayd chegarasi (kun oxiri)");
      const cutoffResponse = page.waitForResponse(
        (r) => r.url().includes("asOf=") && r.status() === 200,
      );
      await asOf.fill(reportDates(1, true).end);
      await cutoffResponse;
      await page
        .getByRole("heading", {
          name: "Ma’lumot to‘liqligi ogohlantirishlari",
          exact: true,
        })
        .waitFor();
      await page.screenshot({
        path: `${root}/${device}/historical-cutoff.png`,
        fullPage: true,
      });
      await page.goto(origin + "/expenses/categories", {
        waitUntil: "networkidle",
      });
      await page.getByLabel("Ijara hisob tasnifi", { exact: true }).waitFor();
      await page.screenshot({
        path: `${root}/${device}/classification.png`,
        fullPage: true,
      });
      entries.push({
        device,
        widths,
        assertions: [
          "No page overflow",
          "Real API report",
          "Chart data table",
          "CSV download",
          "Month filter",
          "Historical recorded cutoff",
          "Category classification visible",
        ],
      });
      await context.close();
    }
    assert.deepEqual(errors, []);
    writeFileSync(
      `${root}/screenshot-manifest.json`,
      JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          source:
            "Real API + built UI; fresh disposable synthetic MongoDB only",
          entries,
          browserErrors: errors,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(
      "8 screenshots; desktop/mobile, 10 widths, filters, as-of, CSV and chart tables passed; zero browser errors.",
    );
  } finally {
    await browser.close();
    await new Promise<void>((r) => server.close(() => r()));
    await mongoose.disconnect();
    await repl.stop();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
