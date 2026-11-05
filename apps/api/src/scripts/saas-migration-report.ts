import mongoose from "mongoose";
import { parseConfig } from "../config.js";
import { connectDatabase } from "../db.js";
import { Tenant } from "../models.js";
import { Subscription } from "../saas-models.js";

// Read-only preflight: no collection/index creation, trial grants, or tenant updates.
try {
  const config = parseConfig(process.env);
  await connectDatabase(config.MONGODB_URI);
  const [summary] = await Tenant.aggregate([
    { $lookup: { from: Subscription.collection.name, localField: "_id", foreignField: "tenantId", as: "subscriptions" } },
    { $group: {
      _id: null,
      total: { $sum: 1 },
      administrativelyBlocked: { $sum: { $cond: [{ $eq: ["$active", false] }, 1, 0] } },
      legacyWithoutSubscription: { $sum: { $cond: [{ $eq: [{ $size: "$subscriptions" }, 0] }, 1, 0] } },
      duplicateSubscriptions: { $sum: { $cond: [{ $gt: [{ $size: "$subscriptions" }, 1] }, 1, 0] } },
    } },
    { $project: { _id: 0 } },
  ]).option({ maxTimeMS: 30_000 });
  console.info(JSON.stringify({
    mode: "read_only",
    ...(summary ?? { total: 0, administrativelyBlocked: 0, legacyWithoutSubscription: 0, duplicateSubscriptions: 0 }),
    note: "Obunasiz markazlar saqlanadi. Tarifni Super Admin orqali alohida biriktiring; avtomatik trial berilmaydi.",
  }));
} catch {
  console.error("Migration hisoboti bajarilmadi. Ulanish va replica set sozlamalarini tekshiring.");
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
