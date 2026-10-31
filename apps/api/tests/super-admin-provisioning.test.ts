import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { User, Tenant } from "../src/models.js";
import { connectDatabase } from "../src/db.js";
import { createSuperAdmin, provisioningInput } from "../src/super-admin-provisioning.js";

let repl: MongoMemoryReplSet;
let uri: string;
const password = randomBytes(20).toString("hex");
const input = (extra: NodeJS.ProcessEnv = {}) => provisioningInput({
  MONGODB_URI: uri, SUPER_ADMIN_EMAIL: "platform@example.test",
  SUPER_ADMIN_NAME: "Platforma egasi", SUPER_ADMIN_PASSWORD: password, ...extra,
});
const hosted = (extra: NodeJS.ProcessEnv = {}) => ({
  GITHUB_ACTIONS: "true", GITHUB_REF: "refs/heads/main",
  MONGODB_URI: "mongodb+srv://operator:temporary@cluster.example.mongodb.net/softlans_edu_demo?retryWrites=true&w=majority",
  PROVISION_EXPECTED_DATABASE: "softlans_edu_demo", PROVISION_FIRST_ADMIN_ONLY: "true", ...extra,
});
beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: "7.0.24" } });
  uri = repl.getUri("provisioning_test");
  await connectDatabase(uri);
  await User.createCollection();
  await User.createIndexes();
});
beforeEach(async () => { await User.deleteMany({}); await Tenant.deleteMany({}); });
afterAll(async () => { await mongoose.disconnect(); await repl?.stop(); });

describe("create-only Super Admin provisioning", () => {
  it("needs no JWT/app configuration, normalizes email and stores a bcrypt hash with null tenant", async () => {
    await createSuperAdmin(input({ SUPER_ADMIN_EMAIL: " PLATFORM@EXAMPLE.TEST " }));
    const user = await User.findOne().select("+passwordHash");
    expect(user!.email).toBe("platform@example.test");
    expect(user!.role).toBe("super_admin");
    expect(user!.tenantId).toBeNull();
    expect(user!.active).toBe(true);
    expect(user!.passwordHash).not.toBe(password);
    expect(await bcrypt.compare(password, user!.passwordHash)).toBe(true);
  });
  it("never promotes or changes an existing tenant account", async () => {
    const tenant = await Tenant.create({ name: "Markaz" });
    const user = await User.create({ email: "platform@example.test", name: "Owner", role: "business_owner", tenantId: tenant._id, passwordHash: "original" });
    await expect(createSuperAdmin(input())).rejects.toMatchObject({ code: 11000 });
    const after = await User.findById(user._id).select("+passwordHash");
    expect(after!.role).toBe("business_owner");
    expect(after!.passwordHash).toBe("original");
    expect(after!.tenantId!.equals(tenant._id)).toBe(true);
    expect(await User.countDocuments()).toBe(1);
  });
  it("refuses repeated first-admin runs even with another email", async () => {
    await createSuperAdmin(input({ PROVISION_FIRST_ADMIN_ONLY: "true" }));
    await expect(createSuperAdmin(input({ SUPER_ADMIN_EMAIL: "second@example.test", PROVISION_FIRST_ADMIN_ONLY: "true" }))).rejects.toThrow("already exists");
    expect(await User.countDocuments()).toBe(1);
  });
  it("resolves concurrent attempts for the same email without duplicate accounts", async () => {
    const results = await Promise.allSettled([createSuperAdmin(input()), createSuperAdmin(input())]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(await User.countDocuments()).toBe(1);
  });
  it("fails closed when the full unique email index is missing", async () => {
    await User.collection.dropIndex("email_1");
    try {
      await expect(createSuperAdmin(input())).rejects.toThrow("index required");
      expect(await User.countDocuments()).toBe(0);
    } finally { await User.createIndexes(); }
  });
  it("validates hosted target, TLS defaults, main branch and bounded waiting before connecting", () => {
    expect(input(hosted()).PROVISION_FIRST_ADMIN_ONLY).toBe("true");
    for (const bad of [
      { GITHUB_REF: "refs/heads/feature" }, { PROVISION_FIRST_ADMIN_ONLY: "false" },
      { PROVISION_EXPECTED_DATABASE: "other" }, { PROVISION_EXPECTED_DATABASE: "" },
      { MONGODB_URI: "mongodb://operator:temporary@localhost/softlans_edu_demo" },
      { MONGODB_URI: "mongodb+srv://operator:temporary@evil.example/softlans_edu_demo" },
      { MONGODB_URI: hosted().MONGODB_URI + "&tls=false" },
      { MONGODB_URI: hosted().MONGODB_URI + "&tlsAllowInvalidCertificates=true" },
      { PROVISION_WAIT_SECONDS: "901" }, { SUPER_ADMIN_PASSWORD: "short" },
    ]) expect(() => input(hosted(bad))).toThrow();
  });
});

function cli(env: NodeJS.ProcessEnv) {
  return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/scripts/super-admin.ts"], {
      cwd: process.cwd(),
      env: { PATH: process.env.PATH, NODE_ENV: "test", DOTENV_CONFIG_PATH: "/dev/null", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", c => { output += c; });
    child.stderr.on("data", c => { output += c; });
    child.on("error", reject);
    child.on("close", code => resolve({ code, output }));
  });
}
it("CLI success and duplicate failure never print URI, password, email or raw errors", async () => {
  const env = { MONGODB_URI: uri, SUPER_ADMIN_EMAIL: "private@example.test", SUPER_ADMIN_NAME: "Private operator", SUPER_ADMIN_PASSWORD: password };
  const success = await cli(env);
  const duplicate = await cli(env);
  expect(success.code).toBe(0);
  expect(duplicate.code).toBe(1);
  for (const result of [success, duplicate]) {
    for (const secret of [uri, password, env.SUPER_ADMIN_EMAIL, env.SUPER_ADMIN_NAME, "E11000", "MongoServerError", "passwordHash"])
      expect(result.output).not.toContain(secret);
  }
});
it("CLI validation failure is sanitized and never writes", async () => {
  const result = await cli({ MONGODB_URI: "invalid-private-uri", SUPER_ADMIN_PASSWORD: "short-private", SUPER_ADMIN_EMAIL: "private" });
  expect(result.code).toBe(1);
  expect(result.output).not.toMatch(/invalid-private-uri|short-private|ZodError|stack/);
  expect(await User.countDocuments()).toBe(0);
});
it("workflow has only explicit dispatch, fixed branch/repository, protected environment and step-only secrets", async () => {
  const workflow = await readFile(new URL("../../../.github/workflows/provision-super-admin.yml", import.meta.url), "utf8");
  expect(workflow).toContain("workflow_dispatch:");
  expect(workflow).not.toMatch(/^  (push|pull_request|schedule|workflow_call):/m);
  expect(workflow).toContain("github.ref == 'refs/heads/main'");
  expect(workflow).toContain("github.repository == 'eagleabror/softlans-edu'");
  expect(workflow).toContain("environment: super-admin-provisioning");
  expect(workflow).toContain("cancel-in-progress: false");
  expect(workflow).toContain("persist-credentials: false");
  expect(workflow).toContain("npm ci --ignore-scripts");
  expect(workflow).not.toMatch(/secrets\.(JWT_SECRET|RENDER_API_KEY)|pull_request_target|upload-artifact|set -x/);
  const beforeProvision = workflow.split("- name: Atlas ruxsatini kutish")[0]!;
  expect(beforeProvision).not.toContain("secrets.");
  for (const action of workflow.matchAll(/uses: ([^\n]+)/g)) expect(action[1]).toMatch(/@[a-f0-9]{40} /);
});
