import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { parseConfig } from "../src/config.js";
import {
  canCreateRole,
  cookieOptions,
  tenantScope,
  type Principal,
} from "../src/security.js";
import {
  registerSchema,
  passwordSchema,
  teamSchema,
} from "../src/validation.js";
import { User } from "../src/models.js";

const env = {
  APP_ORIGIN: "http://localhost:5173",
  MONGODB_URI: "mongodb://localhost/test",
  JWT_SECRET: randomBytes(48).toString("hex"),
};
const input = {
  name: "Aziz Karimov",
  email: " AZIZ@EXAMPLE.TEST ",
  password: randomBytes(16).toString("hex"),
  centerName: "Kelajak",
};
describe("configuration and request validation", () => {
  it("normalizes emails", () => {
    expect(registerSchema.parse(input).email).toBe("aziz@example.test");
  });
  it.each(["tenantId", "role", "passwordHash", "active"])(
    "rejects registration mass assignment: %s",
    (key) => {
      expect(
        registerSchema.safeParse({ ...input, [key]: "super_admin" }).success,
      ).toBe(false);
    },
  );
  it("rejects weak and bcrypt-truncated Unicode passwords", () => {
    expect(passwordSchema.safeParse("short").success).toBe(false);
    expect(passwordSchema.safeParse("🔐".repeat(19)).success).toBe(false);
    expect(passwordSchema.safeParse("a".repeat(72)).success).toBe(true);
  });
  it("never accepts owner or super admin through the team API", () => {
    const { centerName: _centerName, ...member } = input;
    for (const role of ["super_admin", "business_owner"])
      expect(teamSchema.safeParse({ ...member, role }).success).toBe(false);
    expect(teamSchema.safeParse({ ...member, role: "teacher" }).success).toBe(
      true,
    );
  });
  it("fails closed for missing secrets and never includes values in configuration errors", () => {
    expect(() =>
      parseConfig({ ...env, JWT_SECRET: "sensitive-short-value" }),
    ).toThrow("JWT_SECRET");
    expect(() =>
      parseConfig({ ...env, JWT_SECRET: "sensitive-short-value" }),
    ).not.toThrow("sensitive-short-value");
  });
  it("requires an HTTPS origin in production and rejects path origins", () => {
    expect(() => parseConfig({ ...env, NODE_ENV: "production" })).toThrow(
      "APP_ORIGIN",
    );
    expect(() =>
      parseConfig({ ...env, APP_ORIGIN: "http://localhost:5173/" }),
    ).toThrow("APP_ORIGIN");
  });
});
describe("tenant and role invariants", () => {
  it("rejects tenantless and platform actors for tenant operations", () => {
    expect(() =>
      tenantScope({ role: "super_admin", tenantId: null } as Principal),
    ).toThrow();
    expect(() =>
      tenantScope({ role: "teacher", tenantId: null } as Principal),
    ).toThrow();
    const tenantId = new mongoose.Types.ObjectId();
    expect(tenantScope({ role: "teacher", tenantId } as Principal)).toEqual({
      tenantId,
    });
  });
  it("enforces the complete role creation matrix", () => {
    const roles = [
      "super_admin",
      "business_owner",
      "admin",
      "teacher",
    ] as const;
    for (const actor of roles)
      for (const target of roles)
        expect(canCreateRole(actor, target)).toBe(
          (actor === "business_owner" &&
            ["admin", "teacher"].includes(target)) ||
            (actor === "admin" && target === "teacher"),
        );
  });
  it("requires tenant membership for every non-platform role", async () => {
    const invalid = new User({
      name: "Aziz",
      email: "a@example.test",
      passwordHash: "test-hash",
      role: "teacher",
    });
    await expect(invalid.validate()).rejects.toThrow("tenantId");
    const platform = new User({
      name: "Aziz",
      email: "b@example.test",
      passwordHash: "test-hash",
      role: "super_admin",
      tenantId: new mongoose.Types.ObjectId(),
    });
    await expect(platform.validate()).rejects.toThrow("tenantId");
  });
  it("uses secure production cookies without a Domain attribute", () => {
    const options = cookieOptions(
      parseConfig({
        ...env,
        NODE_ENV: "production",
        APP_ORIGIN: "https://edu.example.test",
      }),
    );
    expect(options).toMatchObject({
      secure: true,
      httpOnly: true,
      sameSite: "strict",
      path: "/api",
      maxAge: 3600000,
    });
    expect(options).not.toHaveProperty("domain");
  });
});
