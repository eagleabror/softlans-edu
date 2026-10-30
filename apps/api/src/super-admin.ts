import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import mongoose, { Types } from "mongoose";
import { z } from "zod";
import type {
  PlatformAuditView,
  PlatformStatisticsView,
  PlatformTenantDetailView,
  PlatformTenantsView,
  PlatformTenantStatusView,
  PlatformTenantView,
} from "@softlans/contracts";
import { AppError } from "./errors.js";
import { Student, Tenant, User } from "./models.js";
import { principal, requireRoles } from "./security.js";
import { PlatformAudit } from "./super-admin-models.js";

const QUERY_MS = 3_000;
const PAGE_SIZE = 20;
const DAY_MS = 86_400_000;
const TASHKENT_OFFSET_MS = 5 * 60 * 60_000;
const tenantProjection = "name active createdAt +statusRevision";
const page = z.coerce.number().int().min(1).max(10000).default(1);
const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const listSchema = z.object({
  page,
  search: z.string().trim().max(120).default(""),
  status: z.enum(["active", "blocked"]).optional(),
}).strict();
const auditSchema = z.object({ page, tenantId: objectId.optional() }).strict();
const statusSchema = z.object({
  expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1),
  reason: z.string().trim().min(3).max(300)
    .refine((v) => !/[\u0000-\u001f\u007f]/u.test(v), "Sababni oddiy matn bilan kiriting.")
    // Do not store obvious accidental credentials/contact details in an audit reason.
    // Operators must still avoid other personal information in free text.
    .refine((v) => !/(?:[\w.+-]+@[\w.-]+\.[a-z]{2,}|\beyJ[\w-]+\.[\w-]+\.[\w-]+|\b(?:password|parol|token|secret|api[_ -]?key)\s*[:=]\s*\S+|\+?\d[\d ()-]{7,}\d)/i.test(v),
      "Sababga maxfiy yoki shaxsiy ma’lumot kiritmang."),
}).strict();
function tenantId(value: unknown) {
  if (typeof value !== "string" || !/^[a-f\d]{24}$/i.test(value))
    throw new AppError(404, "NOT_FOUND", "Markaz topilmadi.");
  return new Types.ObjectId(value);
}
function conflict(): never {
  throw new AppError(409, "STATUS_CONFLICT", "Markaz holati o‘zgargan. Ma’lumotlarni yangilab, qayta urinib ko‘ring.");
}
type TenantSummary = {
  _id: Types.ObjectId; name: string; active: boolean;
  createdAt: Date; statusRevision?: number;
};
function tenantView(tenant: TenantSummary, userCount: number, studentCount: number): PlatformTenantView {
  return {
    id: tenant._id.toString(), name: tenant.name,
    status: tenant.active ? "active" : "blocked",
    createdAt: tenant.createdAt.toISOString(),
    statusRevision: tenant.statusRevision ?? 0,
    userCount, studentCount, lastActivityAt: null,
  };
}
function platformLimiter(limit: number) {
  return rateLimit({
    windowMs: 60_000, limit,
    keyGenerator: (req) => principal(req).userId.toString(),
    standardHeaders: "draft-8", legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: {
      code: "RATE_LIMITED", message: "So‘rovlar soni ko‘p. Birozdan so‘ng qayta urinib ko‘ring.",
      requestId: res.locals.requestId,
    } }),
  });
}

export const superAdminRouter = Router();
superAdminRouter.use(requireRoles("super_admin"), (req, _res, next) => {
  if (principal(req).tenantId !== null)
    throw new AppError(403, "FORBIDDEN", "Platforma hisobi talab qilinadi.");
  next();
}, platformLimiter(60));

superAdminRouter.get("/stats", async (_req, res) => {
  const now = new Date();
  const today = new Date(Math.floor((now.getTime() + TASHKENT_OFFSET_MS) / DAY_MS) * DAY_MS - TASHKENT_OFFSET_MS);
  const tomorrow = new Date(today.getTime() + DAY_MS);
  const start = new Date(today.getTime() - 29 * DAY_MS);
  const [tenantStats, growthRows, totalStudents, totalUsers] = await Promise.all([
    Tenant.aggregate<{
      totalTenants: number; activeTenants: number; blockedTenants: number;
      todayTenants: number; last30DaysTenants: number;
    }>([{ $group: {
      _id: null,
      totalTenants: { $sum: 1 },
      activeTenants: { $sum: { $cond: [{ $eq: ["$active", true] }, 1, 0] } },
      blockedTenants: { $sum: { $cond: [{ $eq: ["$active", false] }, 1, 0] } },
      todayTenants: { $sum: { $cond: [{ $and: [{ $gte: ["$createdAt", today] }, { $lt: ["$createdAt", tomorrow] }] }, 1, 0] } },
      last30DaysTenants: { $sum: { $cond: [{ $and: [{ $gte: ["$createdAt", start] }, { $lt: ["$createdAt", tomorrow] }] }, 1, 0] } },
    } }]).option({ maxTimeMS: QUERY_MS, allowDiskUse: false }),
    Tenant.aggregate<{ _id: string; count: number }>([
      { $match: { createdAt: { $gte: start, $lt: tomorrow } } },
      { $group: { _id: { $dateToString: { date: "$createdAt", format: "%Y-%m-%d", timezone: "Asia/Tashkent" } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]).option({ maxTimeMS: QUERY_MS, allowDiskUse: false }),
    Student.countDocuments({}).hint("_id_").maxTimeMS(QUERY_MS),
    User.countDocuments({}).hint("_id_").maxTimeMS(QUERY_MS),
  ]);
  const counts = tenantStats[0];
  const byDay = new Map(growthRows.map((row) => [row._id, row.count]));
  const response: PlatformStatisticsView = {
    totalTenants: counts?.totalTenants ?? 0,
    activeTenants: counts?.activeTenants ?? 0,
    blockedTenants: counts?.blockedTenants ?? 0,
    todayTenants: counts?.todayTenants ?? 0,
    last30DaysTenants: counts?.last30DaysTenants ?? 0,
    totalStudents, totalUsers,
    growth: Array.from({ length: 30 }, (_, i) => {
      const date = new Date(start.getTime() + i * DAY_MS + TASHKENT_OFFSET_MS).toISOString().slice(0, 10);
      return { date, count: byDay.get(date) ?? 0 };
    }),
    timezone: "Asia/Tashkent", generatedAt: now.toISOString(),
  };
  res.json(response);
});

superAdminRouter.get("/tenants", async (req, res) => {
  const input = listSchema.parse(req.query);
  const filter = {
    ...(input.status ? { active: input.status === "active" } : {}),
    ...(input.search ? { name: { $regex: input.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } } : {}),
  };
  const [tenants, total] = await Promise.all([
    Tenant.find(filter).select(tenantProjection).sort({ createdAt: -1, _id: -1 })
      .skip((input.page - 1) * PAGE_SIZE).limit(PAGE_SIZE).maxTimeMS(QUERY_MS).lean(),
    Tenant.countDocuments(filter).maxTimeMS(QUERY_MS),
  ]);
  const ids = tenants.map((tenant) => tenant._id);
  const pipeline = [
    { $match: { tenantId: { $in: ids } } },
    { $group: { _id: "$tenantId", count: { $sum: 1 } } },
  ];
  const [users, students] = ids.length ? await Promise.all([
    User.aggregate<{ _id: Types.ObjectId; count: number }>(pipeline).option({ maxTimeMS: QUERY_MS, allowDiskUse: false }),
    Student.aggregate<{ _id: Types.ObjectId; count: number }>(pipeline).option({ maxTimeMS: QUERY_MS, allowDiskUse: false }),
  ]) : [[], []];
  const userCounts = new Map(users.map((row) => [row._id.toString(), row.count]));
  const studentCounts = new Map(students.map((row) => [row._id.toString(), row.count]));
  const response: PlatformTenantsView = {
    tenants: tenants.map((tenant) => tenantView(tenant,
      userCounts.get(tenant._id.toString()) ?? 0, studentCounts.get(tenant._id.toString()) ?? 0)),
    total, page: input.page, pageSize: PAGE_SIZE,
  };
  res.json(response);
});

superAdminRouter.get("/tenants/:id", async (req, res) => {
  const id = tenantId(req.params.id);
  const tenant = await Tenant.findById(id).select(tenantProjection).maxTimeMS(QUERY_MS).lean();
  if (!tenant) throw new AppError(404, "NOT_FOUND", "Markaz topilmadi.");
  const [owner, userCount, studentCount] = await Promise.all([
    User.findOne({ tenantId: id, role: "business_owner" }).select("name email")
      .sort({ createdAt: 1, _id: 1 }).maxTimeMS(QUERY_MS).lean(),
    User.countDocuments({ tenantId: id }).maxTimeMS(QUERY_MS),
    Student.countDocuments({ tenantId: id }).maxTimeMS(QUERY_MS),
  ]);
  const response: PlatformTenantDetailView = {
    tenant: tenantView(tenant, userCount, studentCount),
    owner: owner ? { id: owner._id.toString(), name: owner.name, email: owner.email } : null,
  };
  res.json(response);
});

const writeLimiter = platformLimiter(20);
for (const action of ["block", "activate"] as const) {
  superAdminRouter.post(`/tenants/:id/${action}`, writeLimiter, async (req, res) => {
    const id = tenantId(req.params.id);
    const input = statusSchema.parse(req.body);
    const actor = principal(req);
    const active = action === "activate";
    const response = await mongoose.connection.transaction(async (session): Promise<PlatformTenantStatusView> => {
      const tenant = await Tenant.findById(id).select("active +statusRevision").session(session).maxTimeMS(QUERY_MS);
      if (!tenant) throw new AppError(404, "NOT_FOUND", "Markaz topilmadi.");
      if (tenant.active === active || (tenant.statusRevision ?? 0) !== input.expectedRevision) conflict();
      // Fail closed for corrupt legacy data: a platform account must never be blocked as a tenant.
      if (await User.exists({ tenantId: id, role: "super_admin" }).session(session).maxTimeMS(QUERY_MS))
        throw new AppError(409, "PROTECTED_TENANT", "Platforma boshqaruv hisobini bloklash mumkin emas.");
      const revisionFilter = input.expectedRevision === 0
        ? { $or: [{ statusRevision: 0 }, { statusRevision: { $exists: false } }] }
        : { statusRevision: input.expectedRevision };
      const result = await Tenant.updateOne(
        { _id: id, active: !active, ...revisionFilter },
        { $set: { active }, $inc: { statusRevision: 1 } },
        { session, maxTimeMS: QUERY_MS },
      );
      if (result.modifiedCount !== 1) conflict();
      if (!active) {
        // Revoked cookies remain invalid after reactivation, requiring a fresh login.
        await User.updateMany({ tenantId: id }, { $inc: { sessionVersion: 1 } }, { session, maxTimeMS: QUERY_MS });
      }
      const revision = input.expectedRevision + 1;
      await PlatformAudit.create([{
        actorId: actor.userId, tenantId: id, action, reason: input.reason,
        previousStatus: active ? "blocked" : "active",
        newStatus: active ? "active" : "blocked", revision,
      }], { session });
      return { tenant: { id: id.toString(), status: active ? "active" : "blocked", statusRevision: revision } };
    }, { maxCommitTimeMS: 5_000 });
    res.json(response);
  });
}

superAdminRouter.get("/audit", async (req, res) => {
  const input = auditSchema.parse(req.query);
  const filter = input.tenantId ? { tenantId: new Types.ObjectId(input.tenantId) } : {};
  const [entries, total] = await Promise.all([
    PlatformAudit.find(filter).select("actorId tenantId action reason createdAt previousStatus newStatus revision")
      .sort({ createdAt: -1, _id: -1 }).skip((input.page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE).maxTimeMS(QUERY_MS).lean(),
    PlatformAudit.countDocuments(filter).maxTimeMS(QUERY_MS),
  ]);
  const response: PlatformAuditView = {
    entries: entries.map((entry) => ({
      id: entry._id.toString(), actorId: entry.actorId.toString(), tenantId: entry.tenantId.toString(),
      action: entry.action, reason: entry.reason, createdAt: entry.createdAt.toISOString(),
      previousStatus: entry.previousStatus, newStatus: entry.newStatus, revision: entry.revision,
    })),
    total, page: input.page, pageSize: PAGE_SIZE,
  };
  res.json(response);
});
