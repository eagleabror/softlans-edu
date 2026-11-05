import { Router } from "express";
import { z } from "zod";
import { Tenant, User, Student } from "./models.js";
import { Group } from "./group-models.js";
import { TelegramIntegration } from "./telegram-models.js";
import { Subscription } from "./saas-models.js";
import { subscriptionView } from "./saas-service.js";
import { onboardingSteps } from "./onboarding-model.js";
import { principal, requireRoles, tenantScope } from "./security.js";
import { AppError } from "./errors.js";

export const onboardingRouter = Router();
onboardingRouter.use(requireRoles("business_owner"));
const text = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((v) => !/[\u0000-\u001f\u007f]/.test(v));
export const centerInput = z
  .object({
    name: text(2, 120),
    phone: z
      .string()
      .trim()
      .regex(/^\+?\d{7,15}$|^$/)
      .optional(),
    address: text(0, 300).optional(),
  })
  .strict();
export const progressInput = z
  .object({
    revision: z.number().int().min(0),
    action: z.enum(["save", "complete", "skip", "dismiss"]),
    currentStep: z.enum(onboardingSteps).optional(),
  })
  .strict();
const missing = () =>
  new AppError(
    404,
    "ONBOARDING_UNAVAILABLE",
    "Bu markaz uchun boshlang‘ich sozlash mavjud emas.",
  );

onboardingRouter.get("/", async (req, res) => {
  const actor = principal(req),
    scope = tenantScope(actor);
  const [tenant, teachers, groups, students, telegram, sub] = await Promise.all(
    [
      Tenant.findOne({ _id: actor.tenantId }).select(
        "name phone address onboarding",
      ),
      User.countDocuments({ ...scope, role: "teacher", active: true }),
      Group.countDocuments({ ...scope, status: "active" }),
      Student.countDocuments({ ...scope, status: "active" }),
      TelegramIntegration.exists({
        ...scope,
        userId: actor.userId,
        status: "connected",
      }),
      Subscription.findOne(scope),
    ],
  );
  if (!tenant) throw missing();
  // Facts are computed from live tenant data, never from client completion claims.
  const facts = {
    center: !!tenant.onboarding?.completedSteps.includes("center"),
    teacher: teachers > 0,
    group: groups > 0,
    students: students > 0,
    telegram: !!telegram,
  };
  res.json({
    state: tenant.onboarding
      ? { tenantId: tenant._id.toString(), ...tenant.toObject().onboarding }
      : null,
    center: {
      name: tenant.name,
      phone: tenant.phone ?? "",
      address: tenant.address ?? "",
    },
    facts,
    counts: { teachers, groups, students },
    subscription: sub ? subscriptionView(sub) : null,
  });
});
onboardingRouter.patch("/center", async (req, res) => {
  const input = centerInput.parse(req.body),
    actor = principal(req);
  // One atomic update records center configuration together with the permitted fields.
  const tenant = await Tenant.findOneAndUpdate(
    { _id: actor.tenantId, active: true, onboarding: { $exists: true } },
    {
      $set: { ...input, "onboarding.updatedAt": new Date() },
      $addToSet: { "onboarding.completedSteps": "center" },
      $inc: { "onboarding.revision": 1 },
    },
    { new: true, runValidators: true },
  );
  if (!tenant) throw missing();
  res.json({
    center: {
      name: tenant.name,
      phone: tenant.phone ?? "",
      address: tenant.address ?? "",
    },
  });
});
onboardingRouter.patch("/progress", async (req, res) => {
  const input = progressInput.parse(req.body),
    actor = principal(req);
  const tenant = await Tenant.findOne({ _id: actor.tenantId }).select(
    "onboarding",
  );
  const state = tenant?.onboarding;
  if (!state) throw missing();
  if (state.revision !== input.revision)
    throw new AppError(409, "ONBOARDING_CONFLICT", "Sozlash boshqa oynada yangilandi. Sahifani yangilab, qayta urinib ko‘ring.");
  const scope = tenantScope(actor);
  const [teacher, group, student, telegram] = await Promise.all([
    User.exists({ ...scope, role: "teacher", active: true }),
    Group.exists({ ...scope, status: "active" }),
    Student.exists({ ...scope, status: "active" }),
    TelegramIntegration.exists({
      ...scope,
      userId: actor.userId,
      status: "connected",
    }),
  ]);
  const completedSteps = [
    ...(state.completedSteps.includes("center") ? ["center"] : []),
    ...(teacher ? ["teacher"] : []),
    ...(group ? ["group"] : []),
    ...(student ? ["students"] : []),
    ...(telegram ? ["telegram"] : []),
    ...(input.action === "complete" || state.status === "completed"
      ? ["completion"]
      : []),
  ];
  const now = new Date();
  const update: Record<string, unknown> = {
    "onboarding.updatedAt": now,
    "onboarding.completedSteps": completedSteps,
  };
  if (input.action === "dismiss") update["onboarding.dismissedAt"] = now;
  else if (state.status !== "completed") {
    update["onboarding.startedAt"] = state.startedAt ?? now;
    update["onboarding.status"] =
      input.action === "complete"
        ? "completed"
        : input.action === "skip"
          ? "skipped"
          : "in_progress";
    if (input.currentStep) update["onboarding.currentStep"] = input.currentStep;
    if (input.action === "complete") update["onboarding.completedAt"] = now;
  }
  const result = await Tenant.findOneAndUpdate(
    {
      _id: actor.tenantId,
      active: true,
      "onboarding.revision": input.revision,
    },
    {
      $set: update,
      $inc: { "onboarding.revision": 1 },
    },
    { new: true, runValidators: true },
  );
  if (!result)
    throw new AppError(
      409,
      "ONBOARDING_CONFLICT",
      "Sozlash boshqa oynada yangilandi. Sahifani yangilab, qayta urinib ko‘ring.",
    );
  res.json({ state: result.onboarding });
});
