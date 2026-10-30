import type { ClientSession } from "mongoose";
import { createHash } from "node:crypto";
import { GuardianLink, NotificationAudit } from "./notification-models.js";
import { Student, Tenant } from "./models.js";
// Executed within Phase 5.1's replay-protected webhook transaction.
export async function guardianCommand(
  command: string | undefined,
  token: string | undefined,
  telegramId: string,
  tx: ClientSession,
) {
  if (command === "/id")
    return `Telegram ID: ${telegramId}. Bu ID hisob egasini aniqlaydi; vasiylikni markaz alohida tasdiqlaydi.`;
  if (command === "/start" && token?.startsWith("g_")) {
    const invalid =
      "Taklif yaroqsiz yoki muddati tugagan. Markazga murojaat qiling.";
    if (!/^g_[A-Za-z0-9_-]{43}$/.test(token)) return invalid;
    const row = await GuardianLink.findOne({
      tokenHash: createHash("sha256").update(token).digest("hex"),
      tokenExpiresAt: { $gt: new Date() },
      expectedTelegramId: telegramId,
    }).session(tx);
    if (
      !row ||
      !(await Tenant.exists({ _id: row.tenantId, active: true }).session(tx)) ||
      !(await Student.exists({
        _id: row.studentId,
        tenantId: row.tenantId,
        status: "active",
      }).session(tx))
    )
      return invalid;
    await GuardianLink.updateOne(
      {
        _id: row._id,
        tokenHash: createHash("sha256").update(token).digest("hex"),
        tokenExpiresAt: { $gt: new Date() },
      },
      {
        $set: { verifiedAt: new Date(), chatId: telegramId, enabled: false },
        $unset: { tokenHash: 1, tokenExpiresAt: 1, consentAt: 1 },
        $inc: { revision: 1 },
      },
      { session: tx },
    );
    await NotificationAudit.create(
      [
        {
          tenantId: row.tenantId,
          action: "guardian_verified",
          targetId: row._id,
        },
      ],
      { session: tx },
    );
    return `Hisob tasdiqlandi. Davomat, dars va to‘lov eslatmalarini olishga rozilik uchun /consent ${row._id} yuboring. /stop — rozilikni bekor qilish; /disconnect — ulanishni uzish. /debt_off, /attendance_off, /lesson_off — alohida xabarlarni o‘chirish.`;
  }
  if (command === "/consent" && /^[a-f\d]{24}$/i.test(token ?? "")) {
    const row = await GuardianLink.findOne({
      _id: token,
      expectedTelegramId: telegramId,
      verifiedAt: { $exists: true },
    }).session(tx);
    if (
      !row ||
      !(await Tenant.exists({ _id: row.tenantId, active: true }).session(tx)) ||
      !(await Student.exists({
        _id: row.studentId,
        tenantId: row.tenantId,
        status: "active",
      }).session(tx))
    )
      return "Ulanish topilmadi.";
    await GuardianLink.updateOne(
      { _id: row._id },
      {
        $set: { enabled: true, consentAt: new Date() },
        $unset: { withdrawnAt: 1 },
        $inc: { revision: 1 },
      },
      { session: tx },
    );
    await NotificationAudit.create(
      [
        {
          tenantId: row.tenantId,
          action: "guardian_consent_granted",
          targetId: row._id,
        },
      ],
      { session: tx },
    );
    return "Rozilik saqlandi. /stop — barcha xabarlarni o‘chirish. /disconnect — ulanishni uzish.";
  }
  if (
    [
      "/stop",
      "/disconnect",
      "/debt_off",
      "/attendance_off",
      "/lesson_off",
    ].includes(command ?? "")
  ) {
    const links = await GuardianLink.find({
      expectedTelegramId: telegramId,
    }).session(tx);
    if (links.length)
      await NotificationAudit.insertMany(
        links.map((g) => ({
          tenantId: g.tenantId,
          action:
            command === "/disconnect"
              ? "guardian_self_disconnected"
              : "guardian_opted_out",
          targetId: g._id,
        })),
        { session: tx },
      );
    const category = command?.match(/^\/(debt|attendance|lesson)_off$/)?.[1];
    await GuardianLink.updateMany(
      { expectedTelegramId: telegramId },
      {
        $set: category
          ? { [category]: false }
          : { enabled: false, withdrawnAt: new Date() },
        ...(command === "/disconnect"
          ? {
              $unset: {
                chatId: 1,
                verifiedAt: 1,
                consentAt: 1,
                tokenHash: 1,
                tokenExpiresAt: 1,
              },
            }
          : {}),
        $inc: { revision: 1 },
      },
      { session: tx },
    );
    if (command !== "/stop")
      return "Sozlamalar saqlandi. Xabarlar to‘xtatildi.";
  }
  return undefined;
}
