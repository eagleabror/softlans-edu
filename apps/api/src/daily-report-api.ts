import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { Config } from "./config.js";
import { principal, requireRoles, tenantScope } from "./security.js";
import { AppError } from "./errors.js";
import { DailyReportSettings } from "./daily-report-models.js";
import { NotificationJob, NotificationAudit } from "./notification-models.js";
import { TelegramIntegration } from "./telegram-models.js";
import { telegramConfigured } from "./telegram.js";
import {
  dailySettingsInput,
  generateDailyReport,
  formatDailyReport,
  enqueueDailyReport,
} from "./daily-reports.js";
export function dailyReportRouter(config: Config) {
  const r = Router();
  r.use(requireRoles("business_owner"));
  r.use(rateLimit({ windowMs: 60000, limit: 30 }));
  const scope = (req: Express.Request) => ({
    ...tenantScope(principal(req)),
    userId: principal(req).userId,
  });
  const settings = async (req: Express.Request) =>
    (await DailyReportSettings.findOne(scope(req))) ??
    new DailyReportSettings(scope(req));
  r.get("/settings", async (req, res) => {
    const s = await settings(req),
      link = await TelegramIntegration.findOne(scope(req));
    res.json({
      settings: dailySettingsInput.parse(
        Object.fromEntries(
          Object.keys(dailySettingsInput.shape).map((k) => [k, s.get(k)]),
        ),
      ),
      telegram: {
        available: telegramConfigured(config),
        connected: link?.status === "connected",
        optedIn: link?.notificationPreferences?.enabled === true,
      },
    });
  });
  r.patch("/settings", async (req, res) => {
    const input = dailySettingsInput.parse(req.body);
    await NotificationAudit.create({
      ...tenantScope(principal(req)),
      actorId: principal(req).userId,
      action: "daily_report_settings_updated",
    });
    await DailyReportSettings.findOneAndUpdate(
      scope(req),
      { $set: input, $inc: { revision: 1 } },
      { upsert: true, runValidators: true },
    );
    res.json({ settings: input });
  });
  r.get("/preview", async (req, res) => {
    const s = await settings(req),
      report = await generateDailyReport(s.tenantId);
    res.json({ report, text: formatDailyReport(report, s.sections) });
  });
  r.get("/history", async (req, res) => {
    const { page } = z
      .object({ page: z.coerce.number().int().min(1).max(10000).default(1) })
      .strict()
      .parse(req.query);
    const filter = {
      ...scope(req),
      kind: { $in: ["owner_daily", "owner_test"] },
    };
    const jobs = await NotificationJob.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * 20)
      .limit(20)
      .select("kind eventDate status attempts errorCode sentAt createdAt");
    res.json({
      jobs,
      page,
      total: await NotificationJob.countDocuments(filter),
    });
  });
  r.get("/history/:id", async (req, res) => {
    const id = z
      .string()
      .regex(/^[a-f\d]{24}$/i)
      .parse(req.params.id);
    const job = await NotificationJob.findOne({
      ...scope(req),
      _id: id,
      kind: { $in: ["owner_daily", "owner_test"] },
    }).select(
      "kind eventDate status attempts errorCode sentAt createdAt report attemptsLog",
    );
    if (!job) throw new AppError(404, "NOT_FOUND", "Hisobot topilmadi.");
    res.json({ job });
  });
  r.post(
    "/test",
    rateLimit({ windowMs: 60000, limit: 3 }),
    async (req, res) => {
      z.object({}).strict().parse(req.body);
      if (!telegramConfigured(config))
        throw new AppError(
          409,
          "TELEGRAM_UNAVAILABLE",
          "Telegram sozlanmagan.",
        );
      let s = await settings(req);
      if (s.isNew) s = await s.save();
      const job = await enqueueDailyReport(s, true);
      if (!job)
        throw new AppError(
          409,
          "RECIPIENT_UNAVAILABLE",
          "Telegramni ulang va bildirishnomalarga rozilik bering.",
        );
      await NotificationAudit.create({
        ...tenantScope(principal(req)),
        actorId: principal(req).userId,
        targetId: job._id,
        action: "daily_report_test_requested",
      });
      res.status(202).json({ id: job.id, status: job.status });
    },
  );
  return r;
}
