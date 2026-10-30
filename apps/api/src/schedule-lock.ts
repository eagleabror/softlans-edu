import type { ClientSession, Types } from "mongoose";
import { Tenant } from "./models.js";
import { AppError } from "./errors.js";
// First operation in every transaction. A real write forces MongoDB write conflicts
// and withTransaction retries against a fresh snapshot; process-local locks cannot do this.
export async function lockScheduling(
  tenantId: Types.ObjectId,
  session: ClientSession,
) {
  const tenant = await Tenant.findOneAndUpdate(
    { _id: tenantId, active: true },
    { $inc: { schedulingRevision: 1 } },
    { session },
  );
  if (!tenant) throw new AppError(404, "NOT_FOUND", "Ma’lumot topilmadi.");
}
