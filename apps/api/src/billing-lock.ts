import type { ClientSession, Types } from "mongoose";
import { Tenant } from "./models.js";
import { AppError } from "./errors.js";
export async function lockBilling(
  tenantId: Types.ObjectId,
  session: ClientSession,
) {
  const tenant = await Tenant.findOneAndUpdate(
    { _id: tenantId, active: true },
    { $inc: { billingRevision: 1 } },
    { session },
  );
  if (!tenant) throw new AppError(404, "NOT_FOUND", "Ma’lumot topilmadi.");
}
