export const TIMEZONE = "Asia/Tashkent";
export function localDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function dayOfWeek(date: string) {
  return ((new Date(date + "T00:00:00Z").getUTCDay() + 6) % 7) + 1;
}
export function addDays(date: string, count: number) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + count);
  return d.toISOString().slice(0, 10);
}
export function weekStart(date: string) {
  return addDays(date, 1 - dayOfWeek(date));
}
type Recurrence = {
  dayOfWeek: number;
  effectiveFrom?: string | null;
  effectiveUntil?: string | null;
};
export function occursBetween(s: Recurrence, from: string, until: string) {
  const first =
    s.effectiveFrom && s.effectiveFrom > from ? s.effectiveFrom : from;
  const last =
    s.effectiveUntil && s.effectiveUntil < until ? s.effectiveUntil : until;
  return (
    first <= last &&
    addDays(first, (s.dayOfWeek - dayOfWeek(first) + 7) % 7) <= last
  );
}
export function rangesOverlap(a: Recurrence, b: Recurrence) {
  return occursBetween(
    a,
    b.effectiveFrom || "0001-01-01",
    b.effectiveUntil || "9999-12-31",
  );
}
