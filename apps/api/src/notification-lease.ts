import { randomUUID } from "node:crypto";
import { NotificationSchedulerLease } from "./notification-models.js";
export const RUN_LEASE_MS = 5 * 60_000;
export async function acquireRunLease(now = new Date()) {
  await NotificationSchedulerLease.updateOne(
    { _id: "automation" },
    { $setOnInsert: { leaseUntil: new Date(0) } },
    { upsert: true },
  ).catch((e) => {
    if (e.code !== 11000) throw e;
  });
  const leaseId = randomUUID();
  const lease = await NotificationSchedulerLease.findOneAndUpdate(
    { _id: "automation", leaseUntil: { $lte: now } },
    { $set: { leaseId, leaseUntil: new Date(now.getTime() + RUN_LEASE_MS) } },
  );
  return lease ? leaseId : null;
}
export async function renewRunLease(leaseId: string, now = new Date()) {
  const result = await NotificationSchedulerLease.updateOne(
    { _id: "automation", leaseId, leaseUntil: { $gt: now } },
    { $set: { leaseUntil: new Date(now.getTime() + RUN_LEASE_MS) } },
  );
  return result.matchedCount === 1;
}
export async function releaseRunLease(leaseId: string) {
  await NotificationSchedulerLease.updateOne(
    { _id: "automation", leaseId },
    { $set: { leaseUntil: new Date(0) }, $unset: { leaseId: 1 } },
  );
}
