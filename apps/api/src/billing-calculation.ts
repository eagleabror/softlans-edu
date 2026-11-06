import type { BillingCalculation, TuitionPolicy } from "@softlans/contracts";
import { addDays, dayOfWeek, localDate } from "./schedule-time.js";
import { monthBounds } from "./billing-validation.js";

export type BillingSchedule = {
  id: string;
  dayOfWeek: number;
  startTime: string;
  effectiveFrom?: string | null;
  effectiveUntil?: string | null;
  status: string;
};
export type BillingLesson = {
  scheduleId: string;
  lessonDate: string;
  startTime: string;
  status: string;
};
// Current supported billing years have a fixed UTC+05:00 offset in Asia/Tashkent.
// Date-only group starts retain the application's existing UTC date-only semantics.
export function calculateTuition(input: {
  month: string;
  monthlyFee: number;
  groupStartDate: Date;
  enrolledAt: Date;
  firstEnrolledAt?: Date;
  schedules: BillingSchedule[];
  sessions?: BillingLesson[];
  policy?: TuitionPolicy;
  dueDay?: number;
}): BillingCalculation {
  const { start, end } = monthBounds(input.month);
  const monthEnd = localDate(end);
  const policy = input.policy ?? "first_partial_month";
  const groupStart = input.groupStartDate.toISOString().slice(0, 10);
  const occurrences = new Map<
    string,
    { startsAt: string; cancelled: boolean }
  >();
  for (const s of input.schedules) {
    if (s.status !== "active") continue;
    for (let d = input.month + "-01"; d < monthEnd; d = addDays(d, 1)) {
      if (
        d < groupStart ||
        (s.effectiveFrom && d < s.effectiveFrom) ||
        (s.effectiveUntil && d > s.effectiveUntil) ||
        dayOfWeek(d) !== s.dayOfWeek
      )
        continue;
      occurrences.set(`${s.id}/${d}`, {
        startsAt: new Date(`${d}T${s.startTime}:00+05:00`).toISOString(),
        cancelled: false,
      });
    }
  }
  // Materialized lessons preserve the old time when a schedule is edited/retired.
  // Cancellation replaces the matching recurrence, never adds a second lesson.
  for (const s of input.sessions ?? []) {
    if (
      s.lessonDate < input.month + "-01" ||
      s.lessonDate >= monthEnd ||
      s.lessonDate < groupStart
    )
      continue;
    occurrences.set(`${s.scheduleId}/${s.lessonDate}`, {
      startsAt: new Date(
        `${s.lessonDate}T${s.startTime}:00+05:00`,
      ).toISOString(),
      cancelled: s.status === "cancelled",
    });
  }
  const lessons = [...occurrences]
    .filter(([, l]) => !l.cancelled)
    .map(([key, l]) => ({ key, startsAt: l.startsAt }))
    .sort(
      (a, b) =>
        a.startsAt.localeCompare(b.startsAt) || a.key.localeCompare(b.key),
    );
  const eligibleLessons = lessons.filter(
    (l) => new Date(l.startsAt) >= input.enrolledAt,
  ).length;
  const totalLessons = lessons.length;
  const firstEnrolledAt = input.firstEnrolledAt ?? input.enrolledAt;
  const prorated =
    policy === "first_partial_month" &&
    firstEnrolledAt >= start &&
    firstEnrolledAt < end;
  // Integer half-up: do not round the lesson price, or multiply floating-point money.
  const calculatedAmount =
    totalLessons === 0
      ? 0
      : prorated
        ? Number(
            (BigInt(input.monthlyFee) * BigInt(eligibleLessons) * 2n +
              BigInt(totalLessons)) /
              (2n * BigInt(totalLessons)),
          )
        : input.monthlyFee;
  const dueDate = new Date(
    Math.max(
      new Date(
        `${input.month}-${String(input.dueDay ?? 10).padStart(2, "0")}T23:59:59.999+05:00`,
      ).getTime(),
      start.getTime(),
      input.enrolledAt.getTime(),
      new Date(`${groupStart}T00:00:00+05:00`).getTime(),
    ),
  ).toISOString();
  return {
    policyVersion: "lesson-tashkent-v1",
    policy,
    timezone: "Asia/Tashkent",
    month: input.month,
    monthlyFee: input.monthlyFee,
    totalLessons,
    eligibleLessons,
    calculatedAmount,
    prorationAmount: input.monthlyFee - calculatedAmount,
    approximateLessonPrice: totalLessons ? input.monthlyFee / totalLessons : 0,
    enrolledAt: input.enrolledAt.toISOString(),
    firstEnrolledAt: firstEnrolledAt.toISOString(),
    dueDate,
    lessons,
  };
}
