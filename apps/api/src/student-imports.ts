import express, { Router } from "express";
import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import ExcelJS from "exceljs";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { Student, User, Tenant } from "./models.js";
import {
  StudentImportLog as Log,
  StudentImportSession as Session,
} from "./import-models.js";
import { principal, requireRoles, tenantScope } from "./security.js";
import { AppError } from "./errors.js";
import {
  guessMapping,
  mappingSchema,
  validateRow,
  duplicateKey,
  type Mapping,
} from "./import-validation.js";
import type { ImportTable } from "./import-parser.js";
import { lockBilling } from "./billing-lock.js";
const problem = (message: string, status = 400) =>
  new AppError(status, "IMPORT_ERROR", message);
let workers = 0;
export async function isolatedParse(
  data: string,
  filename: string,
  sheet: number,
): Promise<ImportTable> {
  if (workers >= 2)
    throw problem("Server band. Birozdan so‘ng qayta urining.", 429);
  workers++;
  try {
    return await new Promise((resolve, reject) => {
      const source = import.meta.url.endsWith(".ts");
      const worker = fork(
        fileURLToPath(
          new URL(
            source ? "./import-worker.ts" : "./import-worker.js",
            import.meta.url,
          ),
        ),
        [],
        {
          execArgv: [
            ...(source ? ["--import", "tsx"] : []),
            "--max-old-space-size=128",
          ],
          stdio: ["ignore", "ignore", "ignore", "ipc"],
        },
      );
      let settled = false;
      const finish = (table?: ImportTable) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.kill();
        table
          ? resolve(table)
          : reject(
              problem(
                "Fayl buzilgan, xavfli yoki belgilangan chegaradan oshgan.",
              ),
            );
      };
      const timer = setTimeout(() => finish(), 8000);
      worker.once("message", (m: { table?: ImportTable }) => finish(m.table));
      worker.once("error", () => finish());
      worker.once("exit", () => finish());
      worker.send({ data, filename, sheet });
    });
  } finally {
    workers--;
  }
}
async function preview(
  rows: string[][],
  mapping: Mapping,
  tenantId: mongoose.Types.ObjectId,
) {
  const parsed = rows.map((row, index) => ({
    row: index + 2,
    ...validateRow(row, mapping),
    duplicate: false,
  }));
  const phones = parsed.flatMap((r) =>
    r.data?.phone
      ? [
          r.data.phone,
          r.data.phone.replace(/^\+/, ""),
          `+${r.data.phone.replace(/^\+/, "")}`,
        ]
      : [],
  );
  const existing = phones.length
    ? await Student.find({ tenantId, phone: { $in: phones } })
        .select("firstName lastName phone")
        .limit(20001)
        .maxTimeMS(5000)
        .lean()
    : [];
  if (existing.length > 20000)
    throw problem("Dublikatlar juda ko‘p. Faylni kichik qismlarga ajrating.");
  const seen = new Set(existing.map(duplicateKey).filter(Boolean));
  for (const r of parsed) {
    if (!r.data) continue;
    const key = duplicateKey(r.data);
    if (key) {
      r.duplicate = seen.has(key);
      seen.add(key);
    }
  }
  return {
    rows: parsed,
    totalRows: parsed.length,
    validRows: parsed.filter((r) => r.data).length,
    invalidRows: parsed.filter((r) => !r.data).length,
    duplicateRows: parsed.filter((r) => r.duplicate).length,
  };
}
function view(log: InstanceType<typeof Log>) {
  return {
    id: log.id,
    filename: log.filename,
    totalRows: log.totalRows,
    importedRows: log.importedRows,
    skippedRows: log.skippedRows,
    failedRows: log.failedRows,
    status: log.status,
    startedAt: log.startedAt,
    completedAt: log.completedAt,
    errorSummary: log.errorSummary,
  };
}
// A crashed request cannot leave an unexplained running import. Every batch checks the same deadline.
async function expireRunning(tenantId: mongoose.Types.ObjectId) {
  await mongoose.connection.transaction(async (session) => {
    await lockBilling(tenantId, session);
    const logs = await Log.find({
      tenantId,
      status: "running",
      deadline: { $lte: new Date() },
    }).session(session);
    for (const log of logs) {
      log.status = log.importedRows ? "partial" : "failed";
      log.failedRows = log.totalRows - log.importedRows - log.skippedRows;
      log.completedAt = new Date();
      log.errorSummary =
        "Jarayon uzildi yoki vaqt chegarasi tugadi. Qolgan qatorlar yozilmadi.";
      await log.save({ session });
    }
  });
}
export const studentImportsRouter = Router();
studentImportsRouter.use(requireRoles("business_owner", "admin"));
studentImportsRouter.use(
  rateLimit({
    windowMs: 60000,
    limit: 60,
    keyGenerator: (req) => principal(req).userId.toString(),
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      error: { message: "So‘rovlar ko‘p. Bir daqiqadan keyin urining." },
    },
  }),
);
studentImportsRouter.post(
  "/preview",
  rateLimit({
    windowMs: 60000,
    limit: 5,
    keyGenerator: (req) => principal(req).userId.toString(),
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
  express.json({ limit: "7mb" }),
  async (req, res) => {
    const input = z
      .object({
        filename: z.string().min(1).max(200),
        data: z
          .string()
          .max(6990508)
          .regex(/^[A-Za-z0-9+/]*={0,2}$/),
        sheet: z.number().int().min(0).max(50).default(0),
      })
      .strict()
      .parse(req.body);
    const buffer = Buffer.from(input.data, "base64");
    if (buffer.length > 5 * 1024 * 1024 || !buffer.length)
      throw problem("Fayl hajmi 5 MB dan oshmasin.", 413);
    const actor = principal(req),
      { tenantId } = tenantScope(actor);
    const table = await isolatedParse(input.data, input.filename, input.sheet);
    if (Buffer.byteLength(JSON.stringify(table)) > 8 * 1024 * 1024)
      throw problem("Yoyilgan ma’lumot hajmi juda katta.");
    const mapping = guessMapping(table.headers);
    const filename = input.filename
      .replace(/[^\p{L}\p{N} ._-]/gu, "_")
      .slice(-120);
    // Limit persisted temporary data as well as parser memory.
    await Session.deleteMany({ expiresAt: { $lte: new Date() } });
    if ((await Session.countDocuments({ tenantId })) >= 10)
      throw problem(
        "Markazda ochiq importlar ko‘p. 15 daqiqadan keyin qayta urining.",
        429,
      );
    const log = await Log.create({
      tenantId,
      uploadedBy: actor.userId,
      filename,
      totalRows: table.rows.length,
    });
    await Session.create({
      _id: log._id,
      tenantId,
      uploadedBy: actor.userId,
      headers: table.headers,
      rows: table.rows,
      mapping,
      expiresAt: new Date(Date.now() + 15 * 60000),
    });
    res.json({
      id: log.id,
      revision: 0,
      headers: table.headers,
      sheets: table.sheets,
      mapping,
      ...(await preview(table.rows, mapping, tenantId)),
    });
  },
);
studentImportsRouter.use(express.json({ limit: "16kb" }));
studentImportsRouter.get("/template", async (_req, res) => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("O‘quvchilar");
  sheet.addRow([
    "Ism",
    "Familiya",
    "Telefon",
    "Ota-ona ismi",
    "Ota-ona telefoni",
    "Tug‘ilgan sana",
    "Qabul sanasi",
    "Izoh",
  ]);
  sheet.addRow([
    "Sinov",
    "O‘quvchi",
    "+998901234567",
    "",
    "",
    "2010-01-25",
    "2026-01-01",
    "",
  ]);
  res
    .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    .attachment("students-template.xlsx")
    .send(Buffer.from(await book.xlsx.writeBuffer()));
});
studentImportsRouter.get("/", async (req, res) => {
  const { page } = z
    .object({ page: z.coerce.number().int().min(1).max(10000).default(1) })
    .strict()
    .parse(req.query);
  const scope = tenantScope(principal(req));
  await expireRunning(scope.tenantId);
  const logs = await Log.find(scope)
    .sort({ createdAt: -1, _id: -1 })
    .skip((page - 1) * 20)
    .limit(20);
  res.json({
    imports: logs.map(view),
    total: await Log.countDocuments(scope),
    page,
  });
});
studentImportsRouter.use("/:id", (req, _res, next) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id))
    throw problem("Import topilmadi.", 404);
  next();
});
studentImportsRouter.get("/:id", async (req, res) => {
  const scope = tenantScope(principal(req));
  await expireRunning(scope.tenantId);
  const log = await Log.findOne({ _id: req.params.id, ...scope });
  if (!log) throw problem("Import topilmadi.", 404);
  res.json({ import: view(log) });
});
studentImportsRouter.post("/:id/mapping", async (req, res) => {
  const { mapping, revision } = z
    .object({ mapping: mappingSchema, revision: z.number().int().min(0) })
    .strict()
    .parse(req.body);
  const scope = {
    ...tenantScope(principal(req)),
    uploadedBy: principal(req).userId,
    _id: req.params.id,
  };
  const current = await Session.findOne({
    ...scope,
    expiresAt: { $gt: new Date() },
  });
  if (!current)
    throw problem("Import sessiyasi topilmadi yoki muddati tugagan.", 404);
  if (Object.values(mapping).some((i) => i >= current.headers.length))
    throw problem("Ustun mavjud emas.");
  const result = await mongoose.connection.transaction(async (session) => {
    const log = await Log.findOneAndUpdate(
      { ...scope, status: "preview" },
      { $set: { status: "preview" } },
      { session },
    );
    if (!log) throw problem("Import allaqachon tasdiqlangan.", 409);
    const updated = await Session.findOneAndUpdate(
      { ...scope, revision },
      { $set: { mapping }, $inc: { revision: 1 } },
      { new: true, session },
    );
    if (!updated) throw problem("Preview o‘zgargan. Qayta tekshiring.", 409);
    return updated;
  });
  res.json({
    id: result.id,
    revision: result.revision,
    headers: result.headers,
    mapping,
    ...(await preview(result.rows, mapping, scope.tenantId)),
  });
});
studentImportsRouter.post("/:id/commit", async (req, res) => {
  const input = z
    .object({
      idempotencyKey: z.uuid(),
      revision: z.number().int().min(0),
      duplicates: z.enum(["skip", "add"]),
      confirmDuplicates: z.boolean().default(false),
    })
    .strict()
    .parse(req.body);
  if (input.duplicates === "add" && !input.confirmDuplicates)
    throw problem("Dublikatlarni qo‘shishga aniq rozilik kerak.");
  const actor = principal(req),
    { tenantId } = tenantScope(actor);
  const scope = { _id: req.params.id, tenantId, uploadedBy: actor.userId };
  await expireRunning(tenantId);
  let log = await Log.findOne(scope);
  if (!log) throw problem("Import topilmadi.", 404);
  if (log.status !== "preview") {
    if (
      log.idempotencyKey !== input.idempotencyKey ||
      log.decision !== input.duplicates
    )
      throw problem("Import avval tasdiqlangan.", 409);
    res.json({ import: view(log) });
    return;
  }
  const current = await Session.findOne({
    ...scope,
    expiresAt: { $gt: new Date() },
    revision: input.revision,
  });
  if (!current)
    throw problem("Preview eskirgan. Faylni qayta tekshiring.", 409);
  const mapping = mappingSchema.parse(current.mapping);
  const deadline = new Date(Date.now() + 45000);
  // Log and session share a transaction with mapping edits, preventing preview/commit races.
  await mongoose.connection.transaction(async (session) => {
    await Session.updateOne(
      { ...scope, revision: input.revision, expiresAt: { $gt: new Date() } },
      { $inc: { revision: 1 } },
      { session },
    ).then((r) => {
      if (!r.modifiedCount) throw problem("Preview eskirgan.", 409);
    });
    const acquired = await Log.updateOne(
      { ...scope, status: "preview" },
      {
        $set: {
          status: "running",
          startedAt: new Date(),
          deadline,
          idempotencyKey: input.idempotencyKey,
          decision: input.duplicates,
        },
      },
      { session },
    );
    if (!acquired.modifiedCount) throw problem("Import avval boshlangan.", 409);
  });
  try {
    for (let offset = 0; offset < current.rows.length; offset += 50) {
      if (Date.now() > deadline.getTime() - 5000)
        throw problem("Vaqt chegarasi tugadi.");
      await mongoose.connection.transaction(
        async (session) => {
          await lockBilling(tenantId, session);
          // Reauthorize every batch: revocation, role changes and inactive tenant stop further writes.
          if (
            !(await User.exists({
              _id: actor.userId,
              tenantId,
              active: true,
              role: { $in: ["admin", "business_owner"] },
              sessionVersion: actor.user.sessionVersion,
            }).session(session)) ||
            !(await Tenant.exists({ _id: tenantId, active: true }).session(
              session,
            ))
          )
            throw problem("Ruxsat bekor qilingan.", 403);
          const active = await Log.findOne({
            ...scope,
            status: "running",
            deadline: { $gt: new Date() },
          }).session(session);
          if (!active) throw problem("Import to‘xtatilgan.", 409);
          let imported = 0,
            skipped = 0,
            failed = 0;
          for (const row of current.rows.slice(offset, offset + 50)) {
            const parsed = validateRow(row, mapping);
            if (!parsed.data) {
              failed++;
              continue;
            }
            const data = parsed.data,
              key = duplicateKey(data);
            let duplicate = false;
            if (key) {
              const digits = data.phone!.replace(/^\+/, "");
              const matches = await Student.find({
                tenantId,
                phone: { $in: [digits, `+${digits}`] },
              })
                .select("firstName lastName phone")
                .session(session)
                .limit(20001)
                .maxTimeMS(3000);
              if (matches.length > 20000)
                throw problem("Dublikatlar juda ko‘p.");
              duplicate = matches.some((s) => duplicateKey(s) === key);
            }
            if (duplicate && input.duplicates === "skip") {
              skipped++;
              continue;
            }
            await Student.create(
              [
                {
                  ...data,
                  tenantId,
                  createdBy: actor.userId,
                  importId: log!._id,
                },
              ],
              { session },
            );
            imported++;
          }
          if (Date.now() >= deadline.getTime())
            throw problem("Vaqt chegarasi tugadi.");
          await Log.updateOne(
            { ...scope, status: "running" },
            {
              $inc: {
                importedRows: imported,
                skippedRows: skipped,
                failedRows: failed,
              },
            },
            { session },
          );
        },
        { maxCommitTimeMS: 5000 },
      );
    }
    log = await Log.findOne(scope);
    await Log.updateOne(
      { ...scope, status: "running" },
      {
        $set: {
          status: log!.failedRows ? "partial" : "completed",
          completedAt: new Date(),
          ...(log!.failedRows
            ? { errorSummary: "Xatoli qatorlar import qilinmadi." }
            : {}),
        },
      },
    );
  } catch {
    log = await Log.findOne(scope);
    await Log.updateOne(
      { ...scope, status: "running" },
      {
        $set: {
          status: log!.importedRows ? "partial" : "failed",
          failedRows: log!.totalRows - log!.importedRows - log!.skippedRows,
          completedAt: new Date(),
          errorSummary:
            "Import uzildi. Qolgan qatorlar yozilmadi; yozilganlar saqlandi.",
        },
      },
    );
  }
  await Session.deleteOne(scope);
  log = await Log.findOne(scope);
  res.json({ import: view(log!) });
});
