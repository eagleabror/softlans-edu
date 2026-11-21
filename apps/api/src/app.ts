import { studentPortalRouter, studentAccountsRouter } from "./student-portal.js";
import { cashRouter } from "./cash.js";
import { managementRouter } from "./management-reports.js";
import { mfaSecurityRouter, beginLoginChallenge, passwordSession } from "./mfa-security.js";
import { DeviceSession } from "./security-models.js";
import { payrollScheduler } from "./payroll-scheduler.js";
import { tuitionScheduler, tuitionAutomation } from "./tuition-scheduler.js";
import { passwordSecurityRouter } from "./password-security.js";
import type { PasswordEmail } from "./password-email.js";
import { onboardingRouter } from "./onboarding.js";
import { Plan } from "./saas-models.js";
import {
  leadsRouter,
  trialsRouter,
  followUpsRouter,
  leadStatistics,
} from "./leads.js";
import { superAdminRouter } from "./super-admin.js";
import { saasRouter, saasAdminRouter } from "./saas.js";
import { paymentOwnerRouter, paymentAdminRouter } from "./payment-routes.js";
import { paymentCallbacks } from "./payment-callbacks.js";
import { createInitialTrial } from "./saas-service.js";
import { studentImportsRouter } from "./student-imports.js";
import { notificationScheduler } from "./notification-scheduler.js";
import { BackgroundLifecycle } from "./background-lifecycle.js";
import { databaseReadiness } from "./readiness.js";
import { dailyReportRouter } from "./daily-report-api.js";
import { notificationRouter } from "./notification-api.js";
import { telegramRouter, telegramWebhook } from "./telegram.js";
import { payrollRouter } from "./payroll.js";
import { attendanceRouter, attendanceSummary } from "./attendance.js";
import { analyticsRouter } from "./analytics.js";
import { debtsRouter, debtSummary } from "./debts.js";
import { billingRouter, billingSummary } from "./billing.js";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { rateLimit, type Options } from "express-rate-limit";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import type { Config } from "./config.js";
import { Tenant, User, type UserRecord } from "./models.js";
import { AppError, errorHandler } from "./errors.js";
import { registerSchema, loginSchema, teamSchema } from "./validation.js";
import {
  authenticate,
  studentAccountAvailable,
  principal,
  requireRoles,
  tenantScope,
  canCreateRole,
  protectWrites,
  createSession,
  cookieOptions,
  COOKIE_NAME,
} from "./security.js";
import type { SessionView, UserView } from "@softlans/contracts";
import { notFound, serveFrontend } from "./frontend.js";

import {
  classroomsRouter,
  schedulesRouter,
  scheduleStatistics,
} from "./schedules.js";
import { groupsRouter, groupStatistics } from "./groups.js";
import { studentsRouter, studentStatistics } from "./students.js";

const dummyHash = bcrypt.hashSync("softlans-internal-timing-padding", 12);
export function userView(user: UserRecord): UserView {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
  };
}
async function sessionView(user: UserRecord): Promise<SessionView> {
  const tenant = user.tenantId
    ? await Tenant.findOne({ _id: user.tenantId, active: true }).select("name")
    : null;
  return {
    user: userView(user),
    tenant: tenant ? { id: tenant._id.toString(), name: tenant.name } : null,
  };
}
export function createApp(
  config: Config,
  options: {
    frontendDist?: string;
    testPasswordEmail?: PasswordEmail;
    lifecycle?: BackgroundLifecycle;
  } = {},
) {
  const lifecycle = options.lifecycle ?? new BackgroundLifecycle();
  const databaseReady = databaseReadiness();
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.TRUST_PROXY_HOPS);
  app.set(
    "notificationSchedulerStaleMs",
    config.MONITOR_SCHEDULER_STALE_SECONDS * 1000,
  );
  app.use((_req, res, next) => {
    res.locals.requestId = randomUUID();
    res.setHeader("X-Request-ID", res.locals.requestId);
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(helmet());
  app.use(
    cors({
      origin: config.APP_ORIGIN,
      credentials: true,
      methods: ["GET", "POST", "PATCH"],
      allowedHeaders: ["Content-Type"],
    }),
  );
  const limiter = (limit: number, windowMs: number, extra: Partial<Options> = {}) =>
    rateLimit({
      windowMs,
      limit,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      ...extra,
      handler: (_req, res) =>
        res.status(429).json({
          error: {
            code: "RATE_LIMITED",
            message:
              "So‘rovlar soni ko‘p. Birozdan so‘ng qayta urinib ko‘ring.",
            requestId: res.locals.requestId,
          },
        }),
    });
  // Coarse abuse ceiling before expensive authentication; individual CRM
  // budgets below use only a database-verified principal, never client IDs.
  const apiLimiter = limiter(10000, 15 * 60_000);
  const crmLimiter = limiter(300, 15 * 60_000, {
    keyGenerator: req => `user:${principal(req).userId}`,
  });
  const authenticated = express.Router().use(authenticate(config), crmLimiter);
  // Provider-to-provider requests use independent authentication, parsers and rate limits.
  // Mount before browser Origin checks and the shared browser IP budget.
  app.use("/api/integrations/payme", paymentCallbacks(config, "payme"));
  app.use("/api/integrations/click", paymentCallbacks(config, "click"));
  // Webhook authentication is independent of browser cookies and CSRF origin checks.
  app.post(
    "/api/integrations/telegram/webhook",
    limiter(600, 60_000),
    express.json({ limit: "16kb", strict: true }),
    telegramWebhook(config),
  );
  // Machine-to-machine authentication is separate from CRM cookies and webhook secrets.
  app.use("/api/internal/notifications", limiter(120, 60_000), notificationScheduler(config, lifecycle));
  app.use("/api/internal/billing", limiter(120, 60_000), tuitionScheduler(config));
  app.use("/api/internal/payroll", limiter(120, 60_000), payrollScheduler(config));
  app.use("/api", (req, res, next) => {
    // Render probes must not exhaust the public API request budget.
    if (
      ["GET", "HEAD"].includes(req.method) &&
      ["/health", "/ready"].includes(req.path.toLowerCase())
    )
      next();
    else apiLimiter(req, res, next);
  });
  app.use(protectWrites(config));
  app.use(
    "/api/student-imports",
    cookieParser(),
    authenticated,
    studentImportsRouter,
  );
  // Attendance bulk requests are bounded to 1000 validated records; other APIs keep their existing limit.
  app.use("/api/attendance", express.json({ limit: "1mb", strict: true }));
  app.use(express.json({ limit: "16kb", strict: true }));
  app.use(cookieParser());
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/ready", async (_req, res) => {
    const ready = !lifecycle.stopping && (await databaseReady());
    res.status(ready ? 200 : 503).json({ ready });
  });

  app.use("/api/auth", mfaSecurityRouter(config, sessionView));
  app.use("/api/auth", passwordSecurityRouter(config, options.testPasswordEmail));

  app.get("/api/auth/registration-plans", limiter(60, 60_000), async (_req, res) => {
    if (!config.PUBLIC_REGISTRATION_ENABLED)
      throw new AppError(403, "REGISTRATION_DISABLED", "Yangi hisob ochish vaqtincha yopilgan.");
    const plans = await Plan.find({ isActive: true }).sort({ monthlyPriceUZS: 1, _id: 1 }).select("name code monthlyPriceUZS studentLimit groupLimit features").lean();
    res.json({ plans: plans.map(p => ({ id: p._id.toString(), name: p.name, code: p.code, monthlyPriceUZS: p.monthlyPriceUZS, studentLimit: p.studentLimit ?? null, groupLimit: p.groupLimit ?? null, features: p.features })) });
  });
  app.post("/api/auth/register", limiter(5, 60 * 60_000), async (req, res) => {
    if (!config.PUBLIC_REGISTRATION_ENABLED)
      throw new AppError(
        403,
        "REGISTRATION_DISABLED",
        "Yangi hisob ochish vaqtincha yopilgan. Demo uchun mas’ul shaxsga murojaat qiling.",
      );
    const input = registerSchema.parse(req.body);
    const passwordHash = await bcrypt.hash(input.password, 12);
    // Transactions require a replica set, including development and CI.
    const user = await mongoose.connection.transaction(async (session) => {
      const [tenant] = await Tenant.create([{ name: input.centerName, onboarding: {} }], {
        session,
      });
      const [owner] = await User.create(
        [
          {
            name: input.name,
            email: input.email,
            passwordHash,
            tenantId: tenant!._id,
            role: "business_owner",
          },
        ],
        { session },
      );
      await createInitialTrial(tenant!._id, owner!._id, session, input.planId);
      return owner!;
    });
    res.cookie(COOKIE_NAME, await createSession(user, config, req), cookieOptions(config));
    res.status(201).json(await sessionView(user));
  });
  app.post("/api/auth/login", limiter(15, 15 * 60_000), async (req, res) => {
    const input = loginSchema.parse(req.body);
    const user = await User.findOne({ email: input.email }).select(
      "+passwordHash +sessionVersion +mfaEnabled +mfaRevision",
    );
    const valid = await bcrypt.compare(
      input.password,
      user?.passwordHash ?? dummyHash,
    );
    if (
      !valid ||
      !user ||
      !user.active ||
      !(await studentAccountAvailable(user)) ||
      (user.role === "super_admin" ? user.tenantId !== null : !user.tenantId) ||
      (user.tenantId &&
        !(await Tenant.exists({ _id: user.tenantId, active: true })))
    ) {
      throw new AppError(
        401,
        "INVALID_CREDENTIALS",
        "Email yoki parol noto‘g‘ri.",
      );
    }
    if (user.mfaEnabled) {
      await beginLoginChallenge(user, config, res);
      return;
    }
    if (user.role === "super_admin" && config.SUPER_ADMIN_MFA_ENFORCED)
      throw new AppError(403, "MFA_ENROLLMENT_REQUIRED", "Ikki bosqichli himoyani operator yordamida faollashtiring.");
    res.cookie(COOKIE_NAME, await passwordSession(user, config, req), cookieOptions(config));
    res.json(await sessionView(user));
  });
  app.get("/api/auth/me", authenticated, async (req, res) =>
    res.json(await sessionView(principal(req).user)),
  );
  app.post("/api/auth/logout", authenticated, async (req, res) => {
    const actor = principal(req);
    if (actor.sessionId) await DeviceSession.updateOne({ sid: actor.sessionId, userId: actor.userId }, { $set: { revokedAt: new Date() } });
    else await User.updateOne({ _id: actor.userId }, { $inc: { sessionVersion: 1 } });
    const { maxAge: _maxAge, ...clearOptions } = cookieOptions(config);
    res.clearCookie(COOKIE_NAME, clearOptions).status(204).end();
  });

  app.use(
    "/api/integrations/telegram",
    authenticated,
    telegramRouter(config),
  );
  app.use(
    "/api/daily-reports",
    authenticated,
    dailyReportRouter(config),
  );
  app.use(
    "/api/notifications",
    authenticated,
    notificationRouter(config),
  );
  app.use("/api/onboarding", authenticated, onboardingRouter);
  app.use("/api/cash", authenticated, cashRouter);
  app.use("/api/management-reports", authenticated, managementRouter);
  app.use("/api/payroll", authenticated, payrollRouter);
  app.use("/api/saas", authenticated, paymentOwnerRouter(config), saasRouter);
  app.use("/api/super-admin/saas", authenticated, paymentAdminRouter(config), saasAdminRouter);
  app.use("/api/super-admin", authenticated, superAdminRouter);
  app.use("/api/attendance", authenticated, attendanceRouter);
  app.use("/api/analytics", authenticated, analyticsRouter);
  app.use("/api/debts", authenticated, debtsRouter);
  app.use("/api/billing/automation", authenticated, tuitionAutomation(config));
  app.use("/api/billing", authenticated, billingRouter);
  app.use("/api/classrooms", authenticated, classroomsRouter);
  app.use("/api/schedules", authenticated, schedulesRouter);
  app.use("/api/groups", authenticated, groupsRouter);
  app.use("/api/leads", authenticated, leadsRouter);
  app.use("/api/trial-lessons", authenticated, trialsRouter);
  app.use("/api/follow-ups", authenticated, followUpsRouter);
  app.use("/api/student", authenticated, studentPortalRouter);
  app.use("/api/students", authenticated, studentAccountsRouter, studentsRouter);

  app.get("/api/dashboard", authenticated, requireRoles("super_admin", "business_owner", "admin", "teacher"), async (req, res) => {
    const actor = principal(req);
    if (actor.role === "super_admin") {
      const [tenantCount, teamCount] = await Promise.all([
        Tenant.countDocuments({ active: true }).maxTimeMS(3_000),
        User.countDocuments({ active: true, role: { $ne: "super_admin" } }).maxTimeMS(3_000),
      ]);
      res.json({
        scope: "platform",
        tenantCount,
        teamCount,
        adminCount: null,
        teacherCount: null,
        joinedAt: actor.user.createdAt.toISOString(),
      });
      return;
    }
    const scope = tenantScope(actor);
    if (actor.role === "teacher") {
      res.json({
        attendance: await attendanceSummary(actor),
        scope: "tenant",
        teamCount: null,
        adminCount: null,
        teacherCount: null,
        joinedAt: actor.user.createdAt.toISOString(),
      });
      return;
    }
    const [
      teamCount,
      adminCount,
      teacherCount,
      students,
      groups,
      scheduling,
      financial,
      debts,
    ] = await Promise.all([
      User.countDocuments({ ...scope, active: true, role: { $in: ["business_owner", "admin", "teacher"] } }),
      User.countDocuments({ ...scope, active: true, role: "admin" }),
      User.countDocuments({ ...scope, active: true, role: "teacher" }),
      studentStatistics(scope),
      groupStatistics(scope),
      scheduleStatistics(scope),
      billingSummary(scope),
      debtSummary(scope),
    ]);
    res.json({
      scope: "tenant",
      teamCount,
      adminCount,
      teacherCount,
      students,
      groups,
      scheduling,
      financial,
      debts,
      leads: await leadStatistics(scope),
      attendance: await attendanceSummary(actor),
      joinedAt: actor.user.createdAt.toISOString(),
    });
  });
  const teamAuth = [
    authenticated,
    requireRoles("business_owner", "admin"),
  ];
  app.get("/api/team", ...teamAuth, async (req, res) => {
    const scope = { ...tenantScope(principal(req)), role: { $in: ["business_owner", "admin", "teacher"] } };
    const pageValue = Number(req.query.page ?? 1);
    if (!Number.isSafeInteger(pageValue) || pageValue < 1 || pageValue > 10000)
      throw new AppError(400, "BAD_PAGE", "Sahifa raqami noto‘g‘ri.");
    const [users, total] = await Promise.all([
      User.find(scope)
        .sort({ createdAt: 1, _id: 1 })
        .skip((pageValue - 1) * 20)
        .limit(20),
      User.countDocuments(scope),
    ]);
    res.json({
      users: users.map(userView),
      total,
      page: pageValue,
      pageSize: 20,
    });
  });
  app.get("/api/team/:id", ...teamAuth, async (req, res) => {
    if (!mongoose.isObjectIdOrHexString(req.params.id))
      throw new AppError(404, "NOT_FOUND", "Foydalanuvchi topilmadi.");
    const user = await User.findOne({
      _id: req.params.id,
      ...tenantScope(principal(req)),
      role: { $in: ["business_owner", "admin", "teacher"] },
    });
    if (!user) throw new AppError(404, "NOT_FOUND", "Foydalanuvchi topilmadi.");
    res.json({ user: userView(user) });
  });
  app.post(
    "/api/team",
    ...teamAuth,
    limiter(20, 60 * 60_000),
    async (req, res) => {
      const input = teamSchema.parse(req.body);
      const actor = principal(req);
      if (!canCreateRole(actor.role, input.role))
        throw new AppError(
          403,
          "FORBIDDEN",
          "Bu rolni yaratish uchun ruxsat yo‘q.",
        );
      const user = await User.create({
        name: input.name,
        email: input.email,
        role: input.role,
        passwordHash: await bcrypt.hash(input.password, 12),
        ...tenantScope(actor),
      });
      res.status(201).json({ user: userView(user) });
    },
  );
  // Reserve every API path before static files and the React Router fallback.
  app.use("/api", (_req, _res, next) => next(notFound()));
  if (options.frontendDist) serveFrontend(app, options.frontendDist);
  app.use((_req, _res, next) => next(notFound()));
  app.use(errorHandler);
  return app;
}
