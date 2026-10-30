import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { Config } from "./config.js";
import {
  GuardianLink,
  NotificationSettings,
  NotificationJob,
  NotificationAudit,
} from "./notification-models.js";
import { Student } from "./models.js";
import { principal, requireRoles, tenantScope } from "./security.js";
import { newLinkToken, hashToken, telegramConfigured } from "./telegram.js";
import { AppError } from "./errors.js";
import { enqueueNotification } from "./notifications.js";
const id = z.string().regex(/^[a-f\d]{24}$/i);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const settingsInput = z
  .object({
    debt: z.boolean(),
    attendance: z.boolean(),
    lesson: z.boolean(),
    debtDays: z
      .array(z.union([z.literal(-3), z.literal(0), z.literal(3), z.literal(7)]))
      .max(4)
      .refine((v) => new Set(v).size === v.length),
    lessonHours: z
      .array(z.union([z.literal(24), z.literal(1)]))
      .max(2)
      .refine((v) => new Set(v).size === v.length),
    late: z.boolean(),
    excused: z.boolean(),
    corrections: z.boolean(),
    quietStart: time,
    quietEnd: time,
    language: z.enum(["uz", "ru"]),
    debtTemplate: z.string().trim().max(500),
    attendanceTemplate: z.string().trim().max(500),
    lessonTemplate: z.string().trim().max(500),
  })
  .strict();
const missing = () => new AppError(404, "NOT_FOUND", "Ma’lumot topilmadi.");
export function notificationRouter(config: Config) {
  const r = Router();
  // Admins have explicit link/history permission in this policy; owner-only settings and sends.
  r.use(requireRoles("business_owner", "admin"));
  r.use(
    rateLimit({
      windowMs: 60000,
      limit: 60,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  const scope = (req: Express.Request) => tenantScope(principal(req));
  const audit = (req: Express.Request, action: string, targetId?: unknown) =>
    NotificationAudit.create({
      ...scope(req),
      actorId: principal(req).userId,
      action,
      targetId,
    });
  r.get("/settings", requireRoles("business_owner"), async (req, res) => {
    const s =
      (await NotificationSettings.findOne(scope(req))) ??
      new NotificationSettings(scope(req));
    res.json({
      settings: settingsInput.parse(
        Object.fromEntries(
          Object.keys(settingsInput.shape).map((key) => [key, s.get(key)]),
        ),
      ),
    });
  });
  r.patch("/settings", requireRoles("business_owner"), async (req, res) => {
    const input = settingsInput.parse(req.body);
    await audit(req, "settings_updated");
    await NotificationSettings.findOneAndUpdate(
      scope(req),
      { $set: input },
      { upsert: true, new: true, runValidators: true },
    );
    res.json({ settings: input });
  });
  r.get("/guardians", async (req, res) => {
    const { studentId } = z.object({ studentId: id }).strict().parse(req.query);
    if (!(await Student.exists({ ...scope(req), _id: studentId })))
      throw missing();
    const guardians = await GuardianLink.find({ ...scope(req), studentId })
      .sort({ createdAt: -1 })
      .limit(100);
    res.json({
      guardians: guardians.map((g) => ({
        id: g._id,
        name: g.name,
        verifiedAt: g.verifiedAt,
        consentAt: g.consentAt,
        enabled: g.enabled,
        debt: g.debt,
        attendance: g.attendance,
        lesson: g.lesson,
        tokenExpiresAt: g.tokenExpiresAt,
      })),
    });
  });
  r.post(
    "/invitations",
    requireRoles("business_owner"),
    rateLimit({ windowMs: 3600000, limit: 20 }),
    async (req, res) => {
      const input = z
        .object({
          studentId: id,
          guardianName: z.string().trim().min(1).max(120),
          telegramId: z
            .string()
            .regex(/^[1-9]\d{0,15}$/)
            .refine((v) => Number.isSafeInteger(Number(v))),
          guardianshipConfirmed: z.literal(true),
        })
        .strict()
        .parse(req.body);
      if (!telegramConfigured(config))
        throw new AppError(
          503,
          "TELEGRAM_UNAVAILABLE",
          "Telegram sozlanmagan.",
        );
      if (
        !(await Student.exists({
          ...scope(req),
          _id: input.studentId,
          status: "active",
        }))
      )
        throw missing();
      const token = `g_${newLinkToken()}`,
        expiresAt = new Date(Date.now() + 600000);
      await audit(req, "guardianship_attested");
      const existing = await GuardianLink.findOne({
        ...scope(req),
        studentId: input.studentId,
        expectedTelegramId: input.telegramId,
      });
      if (existing?.verifiedAt)
        throw new AppError(
          409,
          "ALREADY_LINKED",
          "Avval mavjud ulanishni uzing.",
        );
      const g = await GuardianLink.findOneAndUpdate(
        {
          ...scope(req),
          studentId: input.studentId,
          expectedTelegramId: input.telegramId,
          verifiedAt: { $exists: false },
        },
        {
          $set: {
            authorizedBy: principal(req).userId,
            name: input.guardianName,
            tokenHash: hashToken(token),
            tokenExpiresAt: expiresAt,
          },
        },
        { upsert: true, new: true },
      );
      res.status(201).json({
        guardianId: g._id,
        link: `https://t.me/${config.TELEGRAM_BOT_USERNAME}?start=${token}`,
        expiresAt,
      });
    },
  );
  r.post("/guardians/:id/disconnect", async (req, res) => {
    z.object({}).strict().parse(req.body);
    const g = await GuardianLink.findOne({
      ...scope(req),
      _id: id.parse(req.params.id),
    });
    if (!g) throw missing();
    await audit(req, "guardian_disconnected", g._id);
    await GuardianLink.updateOne(
      { _id: g._id, ...scope(req) },
      {
        $set: { enabled: false, withdrawnAt: new Date() },
        $unset: {
          chatId: 1,
          verifiedAt: 1,
          consentAt: 1,
          tokenHash: 1,
          tokenExpiresAt: 1,
        },
        $inc: { revision: 1 },
      },
    );
    res.status(204).end();
  });
  r.patch("/guardians/:id/preferences", async (req, res) => {
    // Staff may suppress notifications, but only the Telegram account can grant consent.
    const input = z
      .object({
        enabled: z.literal(false).optional(),
        debt: z.literal(false).optional(),
        attendance: z.literal(false).optional(),
        lesson: z.literal(false).optional(),
      })
      .strict()
      .refine((v) => Object.keys(v).length > 0)
      .parse(req.body);
    await audit(req, "guardian_preferences_restricted");
    const result = await GuardianLink.updateOne(
      { ...scope(req), _id: id.parse(req.params.id) },
      { $set: input, $inc: { revision: 1 } },
    );
    if (!result.matchedCount) throw missing();
    res.status(204).end();
  });
  for (const failed of [false, true])
    r.get(failed ? "/failed" : "/history", async (req, res) => {
      const { page } = z
        .object({ page: z.coerce.number().int().min(1).max(10000).default(1) })
        .strict()
        .parse(req.query);
      const filter = {
        ...scope(req),
        kind: { $in: ["debt", "attendance", "lesson", "test"] },
        ...(failed ? { status: "failed" } : {}),
      };
      const [jobs, total] = await Promise.all([
        NotificationJob.find(filter)
          .select(
            "kind status attempts errorCode sentAt createdAt nextAttemptAt attemptsLog",
          )
          .sort({ createdAt: -1, _id: -1 })
          .skip((page - 1) * 20)
          .limit(20),
        NotificationJob.countDocuments(filter),
      ]);
      res.json({ jobs, total, page, pageSize: 20 });
    });
  r.get("/summary", async (req, res) => {
    const rows = await NotificationJob.aggregate<{
      _id: string;
      count: number;
    }>([
      {
        $match: {
          ...scope(req),
          kind: { $in: ["debt", "attendance", "lesson", "test"] },
        },
      },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);
    res.json({ counts: Object.fromEntries(rows.map((v) => [v._id, v.count])) });
  });
  r.post(
    "/test",
    requireRoles("business_owner"),
    rateLimit({ windowMs: 3600000, limit: 5 }),
    async (req, res) => {
      const { guardianId } = z
        .object({ guardianId: id })
        .strict()
        .parse(req.body);
      const g = await GuardianLink.findOne({
        ...scope(req),
        _id: guardianId,
        enabled: true,
        consentAt: { $exists: true },
        verifiedAt: { $exists: true },
      });
      if (!g) throw missing();
      await audit(req, "test_enqueued", g._id);
      const job = await enqueueNotification(g, {
        kind: "test",
        key: `test:${randomUUID()}`,
      });
      res.status(202).json({ jobId: job?._id });
    },
  );
  r.post(
    "/jobs/:id/retry",
    requireRoles("business_owner"),
    rateLimit({ windowMs: 3600000, limit: 10 }),
    async (req, res) => {
      z.object({}).strict().parse(req.body);
      await audit(req, "retry_requested");
      const job = await NotificationJob.findOneAndUpdate(
        {
          ...scope(req),
          _id: id.parse(req.params.id),
          kind: { $in: ["debt", "attendance", "lesson", "test"] },
          status: "failed",
          attempts: { $lt: 5 },
          errorCode: {
            $in: [
              "TELEGRAM_429",
              "TELEGRAM_500",
              "TELEGRAM_502",
              "TELEGRAM_503",
              "TELEGRAM_504",
            ],
          },
        },
        { $set: { status: "pending", nextAttemptAt: new Date() } },
        { new: true },
      );
      if (!job)
        throw new AppError(
          409,
          "RETRY_UNAVAILABLE",
          "Xabarni xavfsiz qayta yuborib bo‘lmaydi.",
        );
      res.status(202).json({ jobId: job._id });
    },
  );
  return r;
}
