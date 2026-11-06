import { describe, it, expect } from "vitest";
import {
  calculateTuition,
  type BillingSchedule,
} from "../src/billing-calculation.js";
const schedules: BillingSchedule[] = [1, 3, 5].map((dayOfWeek) => ({
  id: String(dayOfWeek),
  dayOfWeek,
  startTime: "10:00",
  status: "active",
}));
const calculate = (
  extra: Partial<Parameters<typeof calculateTuition>[0]> = {},
) =>
  calculateTuition({
    month: "2026-11",
    monthlyFee: 300000,
    groupStartDate: new Date("2020-01-01"),
    enrolledAt: new Date("2026-11-16T09:00:00+05:00"),
    schedules,
    ...extra,
  });
describe("Asia/Tashkent lesson-based tuition", () => {
  it.each([
    ["2026-02", 12],
    ["2026-11", 13],
    ["2026-07", 14],
  ])("counts %s exactly (%i lessons)", (month, total) => {
    expect(calculate({ month }).totalLessons).toBe(total);
  });
  it("matches the November example and bills the next month in full", () => {
    expect(calculate()).toMatchObject({
      totalLessons: 13,
      eligibleLessons: 7,
      calculatedAmount: 161538,
      prorationAmount: 138462,
    });
    expect(calculate({ month: "2026-12" }).calculatedAmount).toBe(300000);
  });
  it("counts February 29 in leap years and handles December/year boundaries", () => {
    expect(
      calculate({
        month: "2024-02",
        schedules: [{ ...schedules[0]!, dayOfWeek: 4 }],
      }).totalLessons,
    ).toBe(5);
    expect(
      calculate({
        month: "2025-02",
        schedules: [{ ...schedules[0]!, dayOfWeek: 4 }],
      }).totalLessons,
    ).toBe(4);
    expect(
      calculate({
        month: "2026-12",
        enrolledAt: new Date("2026-12-31T19:00:00Z"),
      }).eligibleLessons,
    ).toBe(0);
  });
  it("includes enrollment at lesson start but excludes it even one millisecond later", () => {
    expect(
      calculate({ enrolledAt: new Date("2026-11-16T05:00:00Z") })
        .eligibleLessons,
    ).toBe(7);
    expect(
      calculate({ enrolledAt: new Date("2026-11-16T05:00:00.001Z") })
        .eligibleLessons,
    ).toBe(6);
    expect(
      calculate({ enrolledAt: new Date("2026-11-15T19:00:00Z") })
        .eligibleLessons,
    ).toBe(7);
  });
  it("respects group start, inclusive effective dates, and multiple lessons on one day", () => {
    expect(
      calculate({ groupStartDate: new Date("2026-11-16") }).totalLessons,
    ).toBe(7);
    const old = schedules.map((s) => ({ ...s, effectiveUntil: "2026-11-15" }));
    const next = schedules.map((s) => ({
      ...s,
      id: "next" + s.id,
      effectiveFrom: "2026-11-16",
      startTime: "15:00",
    }));
    const result = calculate({ schedules: [...old, ...next] });
    expect(result.totalLessons).toBe(13);
    expect(result.eligibleLessons).toBe(7);
    expect(
      calculate({
        schedules: [
          ...schedules,
          { ...schedules[0]!, id: "afternoon", startTime: "15:00" },
        ],
      }).totalLessons,
    ).toBe(18);
  });
  it("uses materialized historical times, excludes cancellations, and counts replacement schedules", () => {
    const result = calculate({
      sessions: [
        {
          scheduleId: "1",
          lessonDate: "2026-11-16",
          startTime: "08:00",
          status: "completed",
        },
        {
          scheduleId: "3",
          lessonDate: "2026-11-18",
          startTime: "10:00",
          status: "cancelled",
        },
        {
          scheduleId: "replacement",
          lessonDate: "2026-11-19",
          startTime: "10:00",
          status: "scheduled",
        },
      ],
    });
    expect(result).toMatchObject({
      totalLessons: 13,
      eligibleLessons: 6,
      calculatedAmount: 138462,
    });
  });
  it("returns an auditable zero charge for no lessons or enrollment after the last lesson", () => {
    expect(calculate({ schedules: [] })).toMatchObject({
      totalLessons: 0,
      eligibleLessons: 0,
      calculatedAmount: 0,
      approximateLessonPrice: 0,
    });
    expect(
      calculate({ enrolledAt: new Date("2026-11-30T11:00:00+05:00") })
        .calculatedAmount,
    ).toBe(0);
  });
  it("rounds half up once with exact integer arithmetic even at maximum safe money", () => {
    expect(
      calculate({
        monthlyFee: 1,
        schedules: [{ ...schedules[0]!, effectiveUntil: "2026-11-09" }],
        enrolledAt: new Date("2026-11-09T00:00:00+05:00"),
      }).calculatedAmount,
    ).toBe(1);
    const fee = Number.MAX_SAFE_INTEGER;
    expect(calculate({ monthlyFee: fee }).calculatedAmount).toBe(
      Number((BigInt(fee) * 7n * 2n + 13n) / 26n),
    );
  });
  it("supports full-month policy and does not reprorate on re-enrollment in later months", () => {
    expect(calculate({ policy: "full_month" }).calculatedAmount).toBe(300000);
    expect(
      calculate({ firstEnrolledAt: new Date("2026-10-01") }).calculatedAmount,
    ).toBe(300000);
    expect(calculate({ dueDay: 20 }).dueDate).toBe("2026-11-20T18:59:59.999Z");
    expect(calculate().dueDate).toBe("2026-11-16T04:00:00.000Z");
  });
});
