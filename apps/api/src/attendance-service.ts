import mongoose, { type ClientSession } from "mongoose";
import { Group, Membership } from "./group-models.js";
import { Schedule } from "./schedule-models.js";
import { LessonSession } from "./attendance-models.js";
import {
  addDays,
  localDate,
  occursBetween,
  dayOfWeek,
} from "./schedule-time.js";
// Caller holds the scheduling lock followed by the billing lock. Sessions are immutable snapshots.
export async function materializeSchedule(
  s: InstanceType<typeof Schedule>,
  until: string,
  tx: ClientSession,
  from?: string,
) {
  const tenant = { tenantId: s.tenantId };
  const group = await Group.findOne({ ...tenant, _id: s.groupId }).session(tx);
  if (!group || s.status !== "active") return;
  let first = from ?? localDate(s.createdAt);
  first = [
    first,
    localDate(s.createdAt),
    localDate(group.startDate),
    s.effectiveFrom ?? first,
  ]
    .sort()
    .at(-1)!;
  const last = [until, localDate(), s.effectiveUntil ?? until].sort()[0]!;
  first = addDays(first, (s.dayOfWeek - dayOfWeek(first) + 7) % 7);
  for (let date = first; date <= last; date = addDays(date, 7)) {
    if (!occursBetween(s, date, date)) continue;
    if (
      await LessonSession.exists({
        ...tenant,
        scheduleId: s._id,
        lessonDate: date,
      }).session(tx)
    )
      continue;
    const roster = await rosterAt(s, date, tx);
    await LessonSession.create(
      [
        {
          ...tenant,
          groupId: s.groupId,
          scheduleId: s._id,
          teacherId: s.teacherId,
          groupName: group.name,
          lessonDate: date,
          startTime: s.startTime,
          endTime: s.endTime,
          roster,
        },
      ],
      { session: tx },
    );
  }
}
export async function rosterAt(
  s: InstanceType<typeof Schedule>,
  date: string,
  tx: ClientSession,
) {
  const tenant = { tenantId: s.tenantId };
  const instant = new Date(`${date}T${s.startTime}:00+05:00`);
  const members = await Membership.find({
    ...tenant,
    groupId: s.groupId,
    enrolledAt: { $lte: instant },
    $or: [
      { status: "active" },
      { removedAt: { $gt: instant } },
      { status: "removed", removedAt: null, updatedAt: { $gt: instant } },
    ],
  })
    .session(tx)
    .select("studentId");
  return [...new Set(members.map((m) => m.studentId.toString()))];
}
export function attendanceTotals(statuses: string[], expected: number) {
  return attendanceCounts(
    Object.fromEntries(
      ["present", "absent", "late", "excused"].map((status) => [
        status,
        statuses.filter((s) => s === status).length,
      ]),
    ),
    expected,
  );
}
export function attendanceCounts(
  counts: Record<string, number>,
  expected: number,
) {
  const { present = 0, absent = 0, late = 0, excused = 0 } = counts;
  const marked = present + absent + late + excused;
  const percentage = (n: number, d: number) =>
    d ? Math.round((n / d) * 10000) / 100 : null;
  return {
    present,
    absent,
    late,
    excused,
    marked,
    unmarked: Math.max(0, expected - marked),
    attendancePercentage: percentage(present + late, marked),
    coveragePercentage: percentage(marked, expected),
  };
}
