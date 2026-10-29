import { afterAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { createApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";

const origin = "https://softlans-demo.example.test";
const env = {
  NODE_ENV: "production",
  APP_ORIGIN: origin,
  MONGODB_URI: "mongodb://localhost/softlans_edu_test?replicaSet=rs0",
  JWT_SECRET: randomBytes(48).toString("hex"),
  TRUST_PROXY_HOPS: "1",
};
const work = fileURLToPath(new URL("../../../work/", import.meta.url));
mkdirSync(work, { recursive: true });
const directory = mkdtempSync(resolve(work, "frontend-test-"));
const html = '<!doctype html><div id="root">SoftLans test shell</div>';
writeFileSync(resolve(directory, "index.html"), html);
mkdirSync(resolve(directory, "assets"));
writeFileSync(resolve(directory, "assets/app.js"), 'console.log("test")');
// Even an accidental API-named file must never be served as frontend content.
mkdirSync(resolve(directory, "api"));
writeFileSync(resolve(directory, "api/accidental.html"), "private");
afterAll(() => rmSync(directory, { recursive: true, force: true }));

describe("single-origin deployment", () => {
  const app = createApp(parseConfig(env), { frontendDist: directory });
  it.each(["/", "/login", "/register", "/team", "/center", "/account"])(
    "serves the SPA for direct navigation and refresh: %s",
    async (path) => {
      const res = await request(app).get(path).set("Accept", "text/html");
      expect(res.status).toBe(200);
      expect(res.text).toBe(html);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.headers["content-security-policy"]).toContain(
        "script-src 'self'",
      );
      expect(res.headers["strict-transport-security"]).toBeTruthy();
    },
  );
  it("serves production assets, including HEAD", async () => {
    const res = await request(app).get("/assets/app.js");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/javascript/);
    expect((await request(app).head("/assets/app.js")).status).toBe(200);
  });
  it.each([
    "/api",
    "/api/unknown",
    "/API/unknown",
    "/api/accidental.html",
    "/assets/missing.js",
    "/assets/missing",
    "/.env",
    "/package.json",
  ])("returns safe JSON 404 instead of SPA HTML: %s", async (path) => {
    const res = await request(app).get(path).set("Accept", "text/html");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect(res.body.error.requestId).toBeTruthy();
    expect(res.body.error).not.toHaveProperty("stack");
  });
  it("does not rewrite non-HTML requests or POSTs to the SPA", async () => {
    expect(
      (await request(app).get("/team").set("Accept", "application/json"))
        .status,
    ).toBe(404);
    expect(
      (await request(app).post("/team").set("Origin", origin).send({})).status,
    ).toBe(404);
  });
  it("keeps liveness and safe database readiness responses", async () => {
    const health = await request(app).get("/api/health");
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ status: "ok" });
    const ready = await request(app).get("/api/ready");
    expect(ready.status).toBe(503);
    expect(ready.body).toEqual({ ready: false });
  });
  it("refuses startup with a missing frontend build", () => {
    expect(() =>
      createApp(parseConfig(env), {
        frontendDist: resolve(directory, "missing"),
      }),
    ).toThrow("Frontend build is required");
  });
  it("requires the exact configured HTTPS Origin behind the proxy", async () => {
    for (const invalid of [
      "",
      "http://softlans-demo.example.test",
      `${origin}/`,
      `${origin}.evil.test`,
      "https://other.example.test",
    ]) {
      const res = await request(app)
        .post("/api/auth/login")
        .set("Origin", invalid)
        .set("X-Forwarded-Proto", "https")
        .send({});
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("INVALID_ORIGIN");
      expect(res.headers["access-control-allow-origin"]).toBe(origin);
    }
    const accepted = await request(app)
      .post("/api/auth/login")
      .set("Origin", origin)
      .set("X-Forwarded-Proto", "https")
      .send({});
    expect(accepted.status).toBe(400); // Origin accepted, then input validation.
    expect(accepted.body.error.code).toBe("VALIDATION_ERROR");
  });
  it("uses only the trusted rightmost forwarded IP for rate limiting", async () => {
    const proxied = createApp(parseConfig(env));
    expect(proxied.get("trust proxy")).toBe(1);
    for (let n = 0; n < 15; n++) {
      const res = await request(proxied)
        .post("/api/auth/login")
        .set("X-Forwarded-For", `198.51.100.${n + 1}, 203.0.113.10`)
        .set("Origin", origin)
        .send({});
      expect(res.status).toBe(400);
    }
    const blocked = await request(proxied)
      .post("/api/auth/login")
      .set("X-Forwarded-For", "198.51.100.200, 203.0.113.10")
      .set("Origin", origin)
      .send({});
    expect(blocked.status).toBe(429);
    const otherClient = await request(proxied)
      .post("/api/auth/login")
      .set("X-Forwarded-For", "203.0.113.11")
      .set("Origin", origin)
      .send({});
    expect(otherClient.status).toBe(400);
  });
});

describe("demo registration configuration", () => {
  it("defaults demo registration closed and local development registration open", () => {
    expect(
      parseConfig({ ...env, DEMO_MODE: "true" }).PUBLIC_REGISTRATION_ENABLED,
    ).toBe(false);
    expect(
      parseConfig({ ...env, NODE_ENV: "development" })
        .PUBLIC_REGISTRATION_ENABLED,
    ).toBe(true);
    expect(parseConfig({ ...env, DEMO_MODE: "false" }).DEMO_MODE).toBe(false);
    expect(
      parseConfig({
        ...env,
        DEMO_MODE: "true",
        PUBLIC_REGISTRATION_ENABLED: "true",
      }).PUBLIC_REGISTRATION_ENABLED,
    ).toBe(true);
    expect(
      parseConfig({
        ...env,
        DEMO_MODE: "false",
        PUBLIC_REGISTRATION_ENABLED: "false",
      }).PUBLIC_REGISTRATION_ENABLED,
    ).toBe(false);
  });
  it.each(["yes", "0", "", "FALSE"])(
    "rejects ambiguous boolean flags: %s",
    (value) => {
      expect(() => parseConfig({ ...env, DEMO_MODE: value })).toThrow(
        "DEMO_MODE",
      );
      expect(() =>
        parseConfig({ ...env, PUBLIC_REGISTRATION_ENABLED: value }),
      ).toThrow("PUBLIC_REGISTRATION_ENABLED");
    },
  );
  it.each([
    "https://*.example.test",
    `${origin}/`,
    `${origin}/path`,
    `${origin}?query=1`,
    `${origin}#fragment`,
    "https://user:password@example.test",
    "ftp://example.test",
    "https://SOFTLANS-demo.example.test",
  ])("rejects non-exact origins: %s", (value) => {
    expect(() => parseConfig({ ...env, APP_ORIGIN: value })).toThrow(
      "APP_ORIGIN",
    );
  });
  it("blocks direct registration before validation, hashing or database writes", async () => {
    const app = createApp(parseConfig({ ...env, DEMO_MODE: "true" }));
    const res = await request(app)
      .post("/api/auth/register")
      .set("Origin", origin)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("REGISTRATION_DISABLED");
    expect(res.headers["set-cookie"]).toBeUndefined();
    const csrf = await request(app).post("/api/auth/register").send({});
    expect(csrf.body.error.code).toBe("INVALID_ORIGIN");
    const login = await request(app)
      .post("/api/auth/login")
      .set("Origin", origin)
      .send({});
    expect(login.body.error.code).toBe("VALIDATION_ERROR");
  });
});
