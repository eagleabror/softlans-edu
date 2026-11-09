import { describe, expect, it } from "vitest";
import { ROLES } from "../src/index.js";

describe("ommaviy rol shartnomasi", () => {
  it("API va web uchun takrorsiz, kelishilgan rollarni eksport qiladi", () => {
    expect([...ROLES].sort()).toEqual([
      "admin", "business_owner", "super_admin", "teacher",
    ]);
    expect(new Set(ROLES).size).toBe(ROLES.length);
  });
});
