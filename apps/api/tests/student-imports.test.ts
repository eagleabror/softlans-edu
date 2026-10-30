import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import ExcelJS from "exceljs";
import { createApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import { connectDatabase } from "../src/db.js";
import { ensureIndexes, Student, Tenant, User } from "../src/models.js";
import { issueToken } from "../src/security.js";
import {
  StudentImportLog as Log,
  StudentImportSession as Session,
} from "../src/import-models.js";
import { parseImport } from "../src/import-parser.js";
import { validateRow, guessMapping } from "../src/import-validation.js";
const origin = "http://localhost:5173";
const config = parseConfig({
  NODE_ENV: "test",
  APP_ORIGIN: origin,
  MONGODB_URI: "mongodb://localhost/test",
  JWT_SECRET: "s".repeat(48),
});
let repl: MongoMemoryReplSet,
  app: ReturnType<typeof createApp>,
  tenant: mongoose.Types.ObjectId,
  owner: string,
  other: string,
  teacher: string,
  platform: string,
  admin: string;
async function actor(
  role: "business_owner" | "admin" | "teacher" | "super_admin",
  tenantId: mongoose.Types.ObjectId | null,
) {
  const user = await User.create({
    tenantId,
    role,
    name: "Synthetic",
    email: `${new mongoose.Types.ObjectId()}@example.test`,
    passwordHash: "unused",
  });
  return `softlans_session=${issueToken(user, config)}`;
}
function post(path: string, body: object, cookie = owner) {
  return request(app)
    .post("/api/student-imports" + path)
    .set("Cookie", cookie)
    .set("Origin", origin)
    .send(body);
}
async function upload(
  csv = "Ism,Familiya,Telefon\nAli,Valiyev,+998901234567",
  cookie = owner,
) {
  return post(
    "/preview",
    { filename: "test.csv", data: Buffer.from(csv).toString("base64") },
    cookie,
  );
}
function commit(
  p: { id: string; revision: number },
  key = crypto.randomUUID(),
  duplicates = "skip",
  confirmDuplicates = false,
) {
  return post(`/${p.id}/commit`, {
    revision: p.revision,
    idempotencyKey: key,
    duplicates,
    confirmDuplicates,
  });
}
beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: "7.0.24" },
  });
  await connectDatabase(repl.getUri("imports"));
  await ensureIndexes();
});
beforeEach(async () => {
  await Promise.all([
    Student.deleteMany({}),
    User.deleteMany({}),
    Tenant.deleteMany({}),
    Log.deleteMany({}),
    Session.deleteMany({}),
  ]);
  tenant = (await Tenant.create({ name: "A" }))._id;
  owner = await actor("business_owner", tenant);
  admin = await actor("admin", tenant);
  other = await actor(
    "business_owner",
    (await Tenant.create({ name: "B" }))._id,
  );
  teacher = await actor("teacher", tenant);
  platform = await actor("super_admin", null);
  app = createApp(config);
});
afterAll(async () => {
  await mongoose.disconnect();
  await repl?.stop();
});
it("previews CSV without writes and commits audited tenant-linked students idempotently", async () => {
  const p = await upload();
  expect(p.status).toBe(200);
  expect(p.body.validRows).toBe(1);
  expect(await Student.countDocuments()).toBe(0);
  const key = crypto.randomUUID();
  const r = await commit(p.body, key);
  expect(r.status).toBe(200);
  expect(r.body.import).toMatchObject({
    status: "completed",
    importedRows: 1,
    failedRows: 0,
  });
  expect((await Student.findOne())?.importId?.toString()).toBe(p.body.id);
  expect((await Student.findOne())?.tenantId.equals(tenant)).toBe(true);
  expect(await Session.countDocuments()).toBe(0);
  expect((await commit(p.body, key)).body).toEqual(r.body);
  expect((await commit(p.body)).status).toBe(409);
  expect(await Student.countDocuments()).toBe(1);
  expect((await Log.findById(p.body.id))?.uploadedBy).toBeTruthy();
});
it("supports actual XLSX, date cells, sheet choice and template", async () => {
  const book = new ExcelJS.Workbook();
  book.addWorksheet("First").addRows([
    ["Ism", "Familiya"],
    ["Ali", "Birinchi"],
  ]);
  book.addWorksheet("Second").addRows([
    ["Ism", "Familiya", "Tug‘ilgan sana"],
    ["Vali", "Ikkinchi", new Date("2010-01-25")],
  ]);
  const buffer = Buffer.from(await book.xlsx.writeBuffer());
  const p = await post("/preview", {
    filename: "test.xlsx",
    data: buffer.toString("base64"),
    sheet: 1,
  });
  expect(p.status).toBe(200);
  expect(p.body.rows[0].data).toMatchObject({
    firstName: "Vali",
    birthDate: "2010-01-25",
  });
  const t = await request(app)
    .get("/api/student-imports/template")
    .set("Cookie", admin);
  expect(t.status).toBe(200);
  expect(t.headers["content-type"]).toContain("spreadsheetml");
});
it("requires manual mapping for unknown headers and rejects stale revisions", async () => {
  const p = await upload("A,B\nAli,Valiyev");
  expect(p.body.invalidRows).toBe(1);
  const mapped = await post(`/${p.body.id}/mapping`, {
    mapping: { firstName: 0, lastName: 1 },
    revision: 0,
  });
  expect(mapped.body.validRows).toBe(1);
  expect((await commit(p.body)).status).toBe(409);
  expect((await commit(mapped.body)).body.import.importedRows).toBe(1);
  expect(
    (
      await post(`/${p.body.id}/mapping`, {
        mapping: { firstName: 0, lastName: 1 },
        revision: 1,
      })
    ).status,
  ).toBe(404);
});
it.each([
  "Ism,Familiya\n,Valiyev",
  "Ism,Familiya,Telefon\nAli,Valiyev,abc",
  "Ism,Familiya,Tug‘ilgan sana\nAli,Valiyev,31.02.2010",
])("shows row errors and skips invalid input: %s", async (csv) => {
  const p = await upload(csv);
  expect(p.status).toBe(200);
  expect(p.body.invalidRows).toBe(1);
  expect(p.body.rows[0].row).toBe(2);
  expect((await commit(p.body)).body.import).toMatchObject({
    status: "partial",
    failedRows: 1,
    importedRows: 0,
  });
});
it("normalizes supported dates and phone formats", () => {
  const r = validateRow(
    ["Ali", "Valiyev", "+998 (90) 123-45-67", "25.01.2010"],
    { firstName: 0, lastName: 1, phone: 2, birthDate: 3 },
  );
  expect(r.data).toMatchObject({
    phone: "+998901234567",
    birthDate: "2010-01-25",
  });
  expect(guessMapping(["Ism", "Familiya", "Ota-ona telefoni"])).toMatchObject({
    firstName: 0,
    lastName: 1,
    parentPhone: 2,
  });
});
it("detects database and in-file duplicates while allowing students without phones", async () => {
  let p = await upload();
  await commit(p.body);
  p = await upload(
    "Ism,Familiya,Telefon\nAli,Valiyev,+998901234567\nAli,Valiyev,+998901234567\nAli,Valiyev,\nAli,Valiyev,",
  );
  expect(p.body.duplicateRows).toBe(2);
  expect((await commit(p.body)).body.import).toMatchObject({
    importedRows: 2,
    skippedRows: 2,
  });
});
it("rechecks duplicates changed after preview and requires explicit add consent", async () => {
  const p = await upload();
  await request(app)
    .post("/api/students")
    .set("Cookie", owner)
    .set("Origin", origin)
    .send({ firstName: "Ali", lastName: "Valiyev", phone: "+998901234567" });
  expect((await commit(p.body, crypto.randomUUID(), "add")).status).toBe(400);
  expect((await commit(p.body)).body.import.skippedRows).toBe(1);
  const q = await upload();
  expect(
    (await commit(q.body, crypto.randomUUID(), "add", true)).body.import
      .importedRows,
  ).toBe(1);
});
it("does not leak other tenants and blocks unauthorized roles, CSRF and client scope overrides", async () => {
  const p = await upload();
  for (const c of [teacher, platform, ""]) {
    expect((await upload(undefined, c)).status).toBe(c ? 403 : 401);
    expect(
      (await request(app).get("/api/student-imports").set("Cookie", c)).status,
    ).toBe(c ? 403 : 401);
  }
  expect(
    (
      await request(app)
        .get(`/api/student-imports/${p.body.id}`)
        .set("Cookie", other)
    ).status,
  ).toBe(404);
  expect(
    (
      await post(
        `/${p.body.id}/commit`,
        {
          revision: 0,
          idempotencyKey: crypto.randomUUID(),
          duplicates: "skip",
        },
        other,
      )
    ).status,
  ).toBe(404);
  expect(
    (await request(app).get("/api/student-imports").set("Cookie", other)).body
      .total,
  ).toBe(0);
  expect(
    (
      await request(app)
        .post("/api/student-imports/preview")
        .set("Cookie", owner)
        .send({})
    ).status,
  ).toBe(403);
  expect(
    (
      await post("/preview", {
        filename: "x.csv",
        data: "YQ==",
        tenantId: tenant,
      })
    ).status,
  ).toBe(400);
});
it("serializes concurrent commits without double insertion", async () => {
  const p = await upload();
  const key = crypto.randomUUID();
  const results = await Promise.all([commit(p.body, key), commit(p.body, key)]);
  expect(results.some((r) => r.status === 200)).toBe(true);
  expect(await Student.countDocuments()).toBe(1);
});
it("records a partial result when a later batch fails", async () => {
  const p = await upload(
    "Ism,Familiya\n" +
      Array.from({ length: 51 }, () => "Ali,Valiyev").join("\n"),
  );
  const original = Student.create.bind(Student);
  let calls = 0;
  const spy = vi
    .spyOn(Student, "create")
    .mockImplementation((...args: unknown[]) => {
      if (++calls === 51) throw new Error("synthetic failure private data");
      return (original as Function)(...args);
    });
  const r = await commit(p.body);
  spy.mockRestore();
  expect(r.body.import).toMatchObject({
    status: "partial",
    importedRows: 50,
    failedRows: 1,
  });
  expect(r.text).not.toContain("private data");
  expect(await Student.countDocuments()).toBe(50);
});
it("rejects expired sessions and recovers interrupted logs accurately", async () => {
  const p = await upload();
  await Session.updateOne(
    { _id: p.body.id },
    { $set: { expiresAt: new Date(0) } },
  );
  expect((await commit(p.body)).status).toBe(409);
  await Log.updateOne(
    { _id: p.body.id },
    { $set: { status: "running", deadline: new Date(0) } },
  );
  const r = await request(app)
    .get(`/api/student-imports/${p.body.id}`)
    .set("Cookie", owner);
  expect(r.body.import).toMatchObject({ status: "failed", failedRows: 1 });
});
it("bounds CSV row count, record size, file size and content", async () => {
  for (const [name, buffer] of [
    ["x.csv", Buffer.from("Ism,Familiya\n" + "Ali,Valiyev\n".repeat(2001))],
    ["x.csv", Buffer.alloc(5 * 1024 * 1024 + 1, 65)],
    ["x.xlsx", Buffer.from("not a zip")],
    ["x.csv", Buffer.from("<html>bad</html>")],
    ["x.csv", Buffer.from([0xff, 0xfe, 0, 0])],
  ] as const) {
    await expect(parseImport(buffer, name)).rejects.toThrow();
  }
});
it("rejects actual workbook formulas and formula strings without evaluating them", async () => {
  const b = new ExcelJS.Workbook();
  const s = b.addWorksheet("Sheet");
  s.addRow(["Ism", "Familiya"]);
  s.addRow([{ formula: 'WEBSERVICE("https://example.test")' }, "Valiyev"]);
  await expect(
    parseImport(Buffer.from(await b.xlsx.writeBuffer()), "test.xlsx"),
  ).rejects.toThrow();
  for (const value of ["=1+1", "@SUM(A1)", "-cmd", "+cmd"])
    expect(
      validateRow(["Ali", "Valiyev", value], {
        firstName: 0,
        lastName: 1,
        notes: 2,
      }).errors.length,
    ).toBeGreaterThan(0);
});
it("limits upload rate", async () => {
  for (let i = 0; i < 5; i++) await post("/preview", {});
  expect((await upload()).status).toBe(429);
});

it("isolates duplicate lookup from other tenants and grants admins preview access", async () => {
  const p = await upload(undefined, other);
  await post(
    `/${p.body.id}/commit`,
    { revision: 0, idempotencyKey: crypto.randomUUID(), duplicates: "skip" },
    other,
  );
  const own = await upload(undefined, admin);
  expect(own.status).toBe(200);
  expect(own.body.duplicateRows).toBe(0);
  expect(
    (
      await post(
        `/${own.body.id}/mapping`,
        { mapping: { firstName: 0, lastName: 1 }, revision: 0 },
        other,
      )
    ).status,
  ).toBe(404);
});
it("rejects macro archives and expanded ZIP bombs before workbook parsing", async () => {
  const { default: JSZip } = await import("jszip");
  for (const macro of [true, false]) {
    const zip = new JSZip();
    zip.file(
      macro ? "xl/vbaProject.bin" : "xl/worksheets/sheet1.xml",
      macro ? "macro" : "x".repeat(21 * 1024 * 1024),
    );
    const buffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
    });
    await expect(parseImport(buffer, "danger.xlsx")).rejects.toThrow();
  }
});
it("rejects invalid and repeated mapping indices without updating a session", async () => {
  const p = await upload();
  for (const mapping of [
    { firstName: 0, lastName: 0 },
    { firstName: 0, lastName: 31 },
    { firstName: 0 },
  ])
    expect(
      (await post(`/${p.body.id}/mapping`, { mapping, revision: 0 })).status,
    ).toBe(400);
  expect((await Session.findById(p.body.id))?.revision).toBe(0);
});
it("uses a tenant-wide admission gate for different import sessions", async () => {
  const p = await upload();
  const q = await upload();
  await Log.updateOne(
    { _id: p.body.id },
    { $set: { status: "running", deadline: new Date(Date.now() + 60000) } },
  );
  expect((await commit(q.body)).status).toBe(409);
  expect(await Student.countDocuments()).toBe(0);
});
