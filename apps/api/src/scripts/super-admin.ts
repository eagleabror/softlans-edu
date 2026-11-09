import "dotenv/config";
import mongoose from "mongoose";
import { setTimeout as delay } from "node:timers/promises";
import { connectDatabase } from "../db.js";
import { createSuperAdmin, provisioningInput } from "../super-admin-provisioning.js";

// No raw exception, input, URI, email, password, or hash is ever logged.
try {
  const input = provisioningInput(process.env);
  mongoose.set("autoCreate", false);
  const deadline = Date.now() + input.PROVISION_WAIT_SECONDS * 1000;
  for (;;) {
    try {
      await connectDatabase(input.MONGODB_URI);
      break;
    } catch {
      await mongoose.disconnect();
      if (Date.now() >= deadline) throw new Error("Connection unavailable");
      console.info("Atlas ulanishi kutilmoqda. Runner /32 IP ruxsati va DB credentials’ini tekshiring.");
      await delay(Math.min(15_000, Math.max(0, deadline - Date.now())));
    }
  }
  // Retry only the connection, never a write with an uncertain outcome.
  await createSuperAdmin(input);
  console.info("Super Admin yaratildi. Vaqtinchalik DB foydalanuvchisi, IP ruxsati va GitHub Secrets’ni bekor qiling.");
} catch {
  console.error("Provisioning bajarilmadi. Target, IP ruxsati, credentials, email bandligi va mavjud Super Adminni tekshiring. Mavjud hisoblar o‘zgartirilmadi; natija noaniq bo‘lsa qayta ishga tushirishdan oldin loginni tekshiring.");
  process.exitCode = 1;
} finally {
  await mongoose.disconnect().catch(() => { process.exitCode = 1; });
}
