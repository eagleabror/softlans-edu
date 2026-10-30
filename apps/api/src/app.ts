import { attendanceRouter, attendanceSummary } from "./attendance.js";
import { analyticsRouter } from "./analytics.js";
import { debtsRouter, debtSummary } from "./debts.js";
import { billingRouter, billingSummary } from "./billing.js";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import type { Config } from "./config.js";
import { Tenant, User, type UserRecord } from "./models.js";
import { AppError, errorHandler } from "./errors.js";
import { registerSchema, loginSchema, teamSchema } from "./validation.js";
import {
  authenticate,
  principal,
  requireRoles,
  tenantScope,
  canCreateRole,
  protectWrites,
  issueToken,
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
  options: { frontendDist?: string } = {},
) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.TRUST_PROXY_HOPS);
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
  const limiter = (limit: number, windowMs: number) =>
    rateLimit({
      windowMs,
      limit,
      standardHeaders: "draft-8",
      legacyHeaders: false,
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
  const apiLimiter = limiter(300, 15 * 60_000);
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
  // Attendance bulk requests are bounded to 1000 validated records; other APIs keep their existing limit.
  app.use("/api/attendance", express.json({ limit: "1mb", strict: true }));
  app.use(express.json({ limit: "16kb", strict: true }));
  app.use(cookieParser());
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/ready", (_req, res) =>
    res
      .status(mongoose.connection.readyState === 1 ? 200 : 503)
      .json({ ready: mongoose.connection.readyState === 1 }),
  );

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
      const [tenant] = await Tenant.create([{ name: input.centerName }], {
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
      return owner!;
    });
    res.cookie(COOKIE_NAME, issueToken(user, config), cookieOptions(config));
    res.status(201).json(await sessionView(user));
  });
  app.post("/api/auth/login", limiter(15, 15 * 60_000), async (req, res) => {
    const input = loginSchema.parse(req.body);
    const user = await User.findOne({ email: input.email }).select(
      "+passwordHash +sessionVersion",
    );
    const valid = await bcrypt.compare(
      input.password,
      user?.passwordHash ?? dummyHash,
    );
    if (
      !valid ||
      !user ||
      !user.active ||
      (user.tenantId &&
        !(await Tenant.exists({ _id: user.tenantId, active: true })))
    ) {
      throw new AppError(
        401,
        "INVALID_CREDENTIALS",
        "Email yoki parol noto‘g‘ri.",
      );
    }
    res.cookie(COOKIE_NAME, issueToken(user, config), cookieOptions(config));
    res.json(await sessionView(user));
  });
  app.get("/api/auth/me", authenticate(config), async (req, res) =>
    res.json(await sessionView(principal(req).user)),
  );
  app.post("/api/auth/logout", authenticate(config), async (req, res) => {
    // Revoke all of this user's issued sessions, including stolen cookie copies.
    await User.updateOne(
      { _id: principal(req).userId },
      { $inc: { sessionVersion: 1 } },
    );
    const { maxAge: _maxAge, ...clearOptions } = cookieOptions(config);
    res.clearCookie(COOKIE_NAME, clearOptions).status(204).end();
  });

  app.use("/api/attendance", authenticate(config), attendanceRouter);
  app.use("/api/analytics", authenticate(config), analyticsRouter);
  app.use("/api/debts", authenticate(config), debtsRouter);
  app.use("/api/billing", authenticate(config), billingRouter);
  app.use("/api/classrooms", authenticate(config), classroomsRouter);
  app.use("/api/schedules", authenticate(config), schedulesRouter);
  app.use("/api/groups", authenticate(config), groupsRouter);
  app.use("/api/students", authenticate(config), studentsRouter);

  app.get("/api/dashboard", authenticate(config), async (req, res) => {
    const actor = principal(req);
    if (actor.role === "super_admin") {
      const [tenantCount, teamCount] = await Promise.all([
        Tenant.countDocuments({ active: true }),
        User.countDocuments({ active: true, role: { $ne: "super_admin" } }),
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
      User.countDocuments({ ...scope, active: true }),
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
      attendance: await attendanceSummary(actor),
      joinedAt: actor.user.createdAt.toISOString(),
    });
  });
  const teamAuth = [
    authenticate(config),
    requireRoles("business_owner", "admin"),
  ];
  app.get("/api/team", ...teamAuth, async (req, res) => {
    const scope = tenantScope(principal(req));
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
