import { chromium } from "./redesign/node_modules/playwright/index.mjs";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { createApp } from "../apps/api/src/app.js";
import { parseConfig } from "../apps/api/src/config.js";
import { connectDatabase } from "../apps/api/src/db.js";
import {
  ensureIndexes,
  Student,
  Tenant,
  User,
} from "../apps/api/src/models.js";
import { Charge } from "../apps/api/src/billing-models.js";
import { Group, Membership } from "../apps/api/src/group-models.js";
import { Classroom, Schedule } from "../apps/api/src/schedule-models.js";
import { generateTuitionMonth } from "../apps/api/src/tuition-service.js";
import { createInitialTrial } from "../apps/api/src/saas-service.js";
import { createSession } from "../apps/api/src/security.js";

// Only synthetic data and a newly allocated local replica set; no external URI.
process.env.MONGOMS_DOWNLOAD_DIR ??= resolve("work/mongodb-binaries");
const root = "artifacts/phase-6.6.1";
for (const device of ["desktop", "mobile"])
  mkdirSync(`${root}/${device}`, { recursive: true });
const repl = await MongoMemoryReplSet.create({
  replSet: { count: 1 },
  binary: { version: "7.0.24" },
});
const origin = "http://localhost:5173";
const config = parseConfig({
  NODE_ENV: "test",
  APP_ORIGIN: origin,
  MONGODB_URI: repl.getUri("tuition_screenshots_disposable"),
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
  email: "tuition-owner@example.test",
  passwordHash: "unused",
});
const teacher = await User.create({
  tenantId: tenant._id,
  role: "teacher",
  name: "Sardor Sinov",
  email: "tuition-teacher@example.test",
  passwordHash: "unused",
});
await createInitialTrial(tenant._id, owner._id);
const students = await Student.create(
  ["Malika", "Javohir"].map((firstName) => ({
    tenantId: tenant._id,
    firstName,
    lastName: "Sinov",
    createdBy: owner._id,
    enrollmentDate: "2026-01-01",
  })),
);
const group = await Group.create({
  tenantId: tenant._id,
  name: "Ingliz tili · A1",
  courseName: "Ingliz tili",
  teacherId: teacher._id,
  monthlyFee: 300000,
  capacity: 20,
  activeMemberCount: 1,
  startDate: "2026-01-01",
});
const room = await Classroom.create({
  tenantId: tenant._id,
  name: "Birinchi xona",
  nameKey: "birinchi xona",
});
await Schedule.create(
  [1, 3, 5].map((dayOfWeek) => ({
    tenantId: tenant._id,
    groupId: group._id,
    teacherId: teacher._id,
    classroomId: room._id,
    dayOfWeek,
    startTime: "10:00",
    endTime: "11:00",
  })),
);
await Membership.create({
  tenantId: tenant._id,
  groupId: group._id,
  studentId: students[0]!._id,
  enrolledAt: "2026-11-16T09:00:00+05:00",
});
await generateTuitionMonth(tenant._id, owner._id, "2026-11", "manual");
const token = await createSession(owner, config);
const server = createApp(config, {
  frontendDist: resolve("apps/web/dist"),
}).listen(5173, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", r));
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const entries: object[] = [];
try {
  for (const [device, width, height] of [
    ["desktop", 1440, 1000],
    ["mobile", 390, 844],
  ] as const) {
    // Restore this device's synthetic enrollment candidate only in the disposable DB.
    await Membership.deleteMany({
      tenantId: tenant._id,
      studentId: students[1]!._id,
    });
    await Charge.deleteMany({
      tenantId: tenant._id,
      studentId: students[1]!._id,
    });
    await Group.updateOne({ _id: group._id }, { activeMemberCount: 1 });
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
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    async function shot(state: string) {
      await page.evaluate(() => document.fonts.ready);
      for (const checkWidth of [
        320, 375, 390, 600, 601, 700, 701, 768, 1024, 1440,
      ]) {
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
      await page.evaluate(() => window.scrollTo(0, 0));
      const file = `${device}/${state}.png`;
      await page.screenshot({ path: `${root}/${file}`, fullPage: true });
      entries.push({
        device,
        state,
        file,
        overflowWidthsChecked: [
          320, 375, 390, 600, 601, 700, 701, 768, 1024, 1440,
        ],
      });
    }
    await page.goto(`${origin}/groups/${group.id}`, {
      waitUntil: "networkidle",
    });
    await page
      .getByRole("combobox", { name: "O‘quvchi", exact: true })
      .selectOption(students[1]!.id);
    await page.getByText("Yakuniy to‘lov", { exact: true }).waitFor();
    assert.equal(
      await page
        .getByRole("checkbox", {
          name: "To‘lov hisobini ko‘rdim va tasdiqlayman",
        })
        .isChecked(),
      false,
    );
    await shot("enrollment-preview");
    // Verify keyboard focus and submission against the real API.
    const confirmation = page.getByRole("checkbox", {
      name: "To‘lov hisobini ko‘rdim va tasdiqlayman",
    });
    await confirmation.focus();
    await page.keyboard.press("Space");
    assert.equal(await confirmation.isChecked(), true);
    await page.getByRole("button", { name: "Qo‘shish", exact: true }).click();
    await page
      .getByRole("cell", { name: "Javohir Sinov", exact: true })
      .waitFor();
    await page.goto(`${origin}/billing`, { waitUntil: "networkidle" });
    await page.getByLabel("Hisob oyi", { exact: true }).fill("2026-11");
    const row = page.getByRole("row").filter({ hasText: "Malika Sinov" });
    await row.getByText("Darslar bo‘yicha hisob", { exact: true }).click();
    await page
      .getByRole("dialog")
      .getByText("Qolgan darslar", { exact: true })
      .waitFor();
    assert.match(await row.innerText(), /161\D*538/);
    await shot("billing-calculation");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Yopish" })
      .click();
    await page
      .getByRole("button", { name: "Oylik hisob yaratish", exact: true })
      .click();
    await page.getByRole("dialog").waitFor();
    await shot("manual-fallback");
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.deepEqual(errors, []);
    await context.close();
  }
  writeFileSync(
    `${root}/screenshot-manifest.json`,
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        source: "Real local API and built frontend; synthetic disposable data",
        entries,
        browserErrors: [],
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await browser.close();
  await new Promise<void>((r) => server.close(() => r()));
  await mongoose.disconnect();
  await repl.stop();
}
