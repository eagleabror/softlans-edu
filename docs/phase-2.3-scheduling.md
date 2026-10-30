# Phase 2.3 — Lesson scheduling and classrooms

## Scope and implementation

Adds tenant-scoped classrooms, recurring weekly lessons, Uzbek schedule and weekly
calendar pages, classroom and lesson forms, schedules in group details, and owner/
admin dashboard counts. Existing authentication, students, groups, membership and
team functionality remain in place. Attendance, billing, payroll, notifications
and subscriptions are outside this change.

Each existing tenant represents one center. No separate branch/center model is
introduced. Teachers are taken from a group's existing teacher assignment.

Classroom names are unique per tenant after trimming, NFKC normalization and
Uzbek-aware lowercasing. Capacity is optional (1–10000 when provided). Names are
reserved even after deactivation. Deactivation requires all active assignments to
be deactivated or moved first. There is no destructive delete operation.

## Scheduling semantics

- `dayOfWeek`: 1=Monday through 7=Sunday.
- `startTime` / `endTime`: local `HH:mm`, same-day lessons only; start < end.
- Timezone: `Asia/Tashkent`. No client-supplied timezone or tenant ID.
- `effectiveFrom` / `effectiveUntil`: optional inclusive local ISO dates; null
  means unbounded. Conflict detection checks whether the intersecting date range
  actually contains the scheduled weekday.
- Time intervals are half-open: `[startTime, endTime)`; adjacent lessons are valid.
- Active lessons cannot overlap for a teacher, classroom or group. Inactive
  records do not reserve resources, but all references remain tenant-validated.
- A group must be active, its teacher active and assigned, and its room active
  when activating a lesson. Teacher changes and pausing/archiving a group are
  blocked while it has active schedule records, including expired records until
  explicitly deactivated. Inactive records retain their historical teacher IDs.
- For a teacher handover: deactivate old schedules, change the group's teacher,
  then create new schedules. Retain the old records rather than reassigning them.

## Concurrency and database requirements

Uses the existing MongoDB replica-set transaction infrastructure. Every schedule
write, classroom write, and group update first increments a hidden
`Tenant.schedulingRevision` field inside the same transaction. This creates a
shared database write dependency and prevents snapshot-isolation write skew.
MongoDB's transaction retry mechanism rechecks conflicts against fresh state.
This works across processes/instances, not just inside one Node process.

The tenant record already exists, avoiding first-use lock creation races. Startup
creates classroom/schedule collections and indexes using existing `ensureIndexes`.
No credentials or environment variables need changing.

Tradeoff: scheduling writes and group edits within one center serialize. Different
centers are independent. Weekly views and dashboard statistics stream candidate
records rather than imposing an arbitrary result cap; totals still require a scan.
Weekly results are paginated, so a busy calendar can span multiple pages.

## API

All routes inherit the existing authenticated-cookie, origin/JSON, rate-limit,
error-envelope and tenant-scope conventions. Invalid input returns 400, forbidden
roles 403, missing/foreign records 404, and resource/name conflicts 409 with Uzbek
messages. Inputs are strict allowlists. Output omits tenant IDs, internal lock
counters, password hashes and email addresses.

| Method | Path                             | Behavior                                                     |
| ------ | -------------------------------- | ------------------------------------------------------------ |
| GET    | `/api/classrooms`                | Paginated list; optional `status`                            |
| POST   | `/api/classrooms`                | Create                                                       |
| GET    | `/api/classrooms/:id`            | Detail                                                       |
| PATCH  | `/api/classrooms/:id`            | Edit including `status`                                      |
| POST   | `/api/classrooms/:id/deactivate` | Safe soft deactivation; body `{}`                            |
| GET    | `/api/schedules`                 | Paginated recurring records                                  |
| POST   | `/api/schedules`                 | Create                                                       |
| GET    | `/api/schedules/weekly`          | Local week occurrences, default current week                 |
| GET    | `/api/schedules/:id`             | Detail                                                       |
| PATCH  | `/api/schedules/:id`             | Edit including activation/deactivation                       |
| POST   | `/api/schedules/:id/deactivate`  | Soft deactivation; body `{}`                                 |
| GET    | `/api/dashboard`                 | Preserves existing fields; adds `scheduling` for owner/admin |

List filters: `groupId`, `teacherId`, `classroomId`, `dayOfWeek`, `status`.
Pagination: `page` (default 1), `pageSize` (default 20, max 100).
Weekly additionally accepts `date=YYYY-MM-DD`, chooses that date's Monday–Sunday
week, defaults to active records, and returns `weekStart`, `weekEnd`, `timezone`
and each lesson's local `date`.

Owner/admin can manage both resources. Teachers can only read their own schedules,
including inactive historical records; teacher identity is enforced server-side.
Teachers cannot browse classroom management. Super admins have no tenant access.

## Changed files

- API: `src/schedule-models.ts`, `schedule-validation.ts`, `schedule-time.ts`,
  `schedule-lock.ts`, `schedules.ts` (new); `app.ts`, `models.ts`, `groups.ts`.
- API checks: `tests/schedules.test.ts` (new), `package.json` integration script.
- Web: `src/Scheduling.tsx`, `Scheduling.test.tsx` (new); `App.tsx`, `Groups.tsx`,
  `Groups.test.tsx`, `styles.css`.
- Shared API views: `packages/contracts/src/index.ts`.
- This implementation/acceptance document.

## Verification

Uses synthetic users, classrooms and groups only; no real student data.
Backend integration tests run against an ephemeral MongoDB 7 replica set and cover
classrooms, strict validation, create/edit/deactivate/reactivate, all three
conflict resources, adjacency, effective dates, concurrent inserts/edits,
classroom retirement races, teacher reassignment races, inactive-reference IDOR,
tenant isolation, RBAC, weekly pagination/filtering, dashboard counts, origin
checks, and Tashkent midnight/week/year boundaries.

Frontend tests cover calendar blocks, filters/navigation, read-only teacher
controls, errors/retry/empty states, classroom creation, schedule submission,
conflict feedback and deactivation. Existing Phase 1, 2.1 and 2.2 tests are run
alongside these checks. Typecheck, production build and both full/production npm
audits passed before opening the PR: 160 backend tests and 20 frontend tests
passed (180 total); the explicit integration command also passed all 75 tests.
Both full and production dependency audits reported zero vulnerabilities.

## Manual acceptance checklist

These browser checks remain for reviewer acceptance; automated component tests do
not establish a visual check on real devices.

- [ ] Owner/admin: create, rename, edit capacity and deactivate a classroom.
- [ ] Reject duplicate names in the same center; permit names in another center.
- [ ] Add multiple lessons for a group and verify their assigned teacher.
- [ ] Confirm teacher, room and group conflicts show clear Uzbek messages.
- [ ] Confirm 10:00–11:00 and 11:00–12:00 are accepted.
- [ ] Verify effective-range boundaries in weekly navigation.
- [ ] Move/deactivate assignments before retiring a room or changing a teacher.
- [ ] Confirm old deactivated records retain their teacher and references.
- [ ] Verify group, teacher, classroom and weekday filters and pagination.
- [ ] Verify schedule sections in existing group details.
- [ ] Teacher: only own lessons are visible; mutation routes are forbidden.
- [ ] Another center and super admin cannot access tenant records by ID.
- [ ] Compare dashboard counts to the current Tashkent day/week.
- [ ] Check desktop calendar, mobile list, loading/empty/error states and keyboard use.
- [ ] Smoke-test login/logout, students, enrollment, groups and team management.

## Limitations

Recurring patterns only: no holidays, one-off exceptions, overnight lessons,
attendance or reminder generation. Deactivation retains records, but edits do not
create an immutable audit/version history. Room capacity does not constrain group
capacity. Classroom management is owner/admin only. No deployment or infrastructure
credential changes are included.
