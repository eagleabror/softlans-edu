# Phase 4.1 — Student attendance

Phase 4.1 adds lesson occurrences, attendance, Uzbek teacher workflows and attendance KPIs. No payroll, notification, subscription, payment gateway, hosting or credential changes.

## Architecture and history

`LessonSession` snapshots schedule/group/teacher/date/times/group name and eligible student IDs. A unique `(tenantId, scheduleId, lessonDate)` index makes occurrence creation idempotent. `AttendanceRecord` has a unique `(tenantId, sessionId, studentId)` index, one explicit status, optional note and server-generated actor/timestamps. Existing startup index provisioning creates both collections and indexes before readiness.

The UI calls `POST /generate` before listing a requested period. Sessions are generated for actual weekly occurrences, bounded by schedule creation date, group start, effective dates and today in Asia/Tashkent. Future sessions are deliberately not materialized. Before an existing schedule is edited or deactivated, its occurrences through today are materialized in the same transaction, preserving the previous assignment and times. There are no session deletion APIs.

Enrollment intervals use `enrolledAt <= lesson start` and `removedAt > lesson start` (Asia/Tashkent). New removals save an explicit `removedAt`. Older removed memberships use their existing `updatedAt` as a compatibility fallback. Re-enrollments remain separate intervals; student IDs are deduplicated in the roster. Once materialized, a roster is frozen, including when enrollments or assignments subsequently change. Students without a record are unmarked, never implicitly absent.

All attendance mutations acquire the existing tenant scheduling and billing locks, using the same Tenant document as schedule, group, enrollment and billing mutations. MongoDB transactions serialize changes across processes and retry write conflicts. A session revision submitted by the browser rejects stale writes with HTTP 409. Every student in a batch must be in the session snapshot; invalid batches roll back completely. Each batch is atomic. The UI saves large rosters in batches of 100 and retains unsaved edits if a later batch fails. The API accepts at most 1000 records and 1 MiB per request; other APIs retain their existing 16 KiB body limit.

## Authorization

Tenant and marker identities come only from authenticated server state. Strict request schemas reject tenantId, markedBy and unknown fields. Cookie JWT authentication and Origin/JSON CSRF enforcement remain in place.

Owners/admins can view, mark, correct, cancel and restore their own tenant's attendance. Teachers need the session's original teacher identity **and** current group and schedule teacher assignment. After reassignment, neither the former teacher nor the replacement can read or mark the former teacher's historical sessions; managers retain access. Teachers cannot cancel sessions or access finance. Super admins have no tenant attendance access. Roster responses expose names, attendance and notes, without contact/financial fields. Logs retain only existing safe request metadata.

## API

All paths below are under `/api/attendance` and require authentication.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/today` | Today's stored sessions plus current recurring lesson references |
| GET | `/sessions` | Paginated occurrence history |
| POST | `/generate` | Idempotently materialize a period |
| POST | `/sessions` | Create/retrieve `{scheduleId, lessonDate}` |
| GET | `/sessions/:id/roster` | Snapshot roster with explicit status or null |
| POST, PATCH | `/sessions/:id/attendance` | `{revision, records: [{studentId,status,note?}]}` |
| PATCH | `/sessions/:id` | Manager cancellation/restoration `{revision,status}` |
| GET | `/groups/:id/history` | Paginated group sessions |
| GET | `/students/:id/history` | Paginated student sessions |
| GET | `/summary` | Session counts, status counts, attendance and coverage |

Period endpoints accept `start`, `end` (YYYY-MM-DD), optional `groupId`, `studentId`, `page` and `pageSize`. Dates default to today; inclusive ranges are at most 93 days, without future dates. Page size defaults to 20, maximum 100; summary limits to 5000 sessions and uses indexed aggregation with a 15-second query budget. Generate accepts the same period object. Generate first to include all occurrences in historical reports. `/today` additionally exposes recurring references so callers can discover a lesson before its session exists. Dashboard today's counts and coverage also include not-yet-opened recurring lessons.

## Metrics

Cancelled sessions and their records are excluded from attendance calculations, retained in history and counted separately.

- Total sessions: scheduled + completed non-cancelled occurrences.
- Completed: every roster student has an explicit record. Empty rosters remain scheduled.
- Awaiting: non-cancelled sessions whose attendance is incomplete.
- Marked: present + absent + late + excused; each record counted once.
- Attendance %: `(present + late) / marked × 100`, including excused in the denominator.
- Coverage %: `marked / eligible roster places × 100`.
- Zero denominator: `null`, rendered as `—`; percentages rounded to two decimals.

Group/student filters apply to numerator and denominator. Student totals count one eligible place per lesson. Today dashboard coverage includes eligible places in unmaterialized current lessons. Historical reporting uses saved sessions; the attendance UI generates the requested period first. Dashboard summaries never expose finance to teachers or attendance to super admins.

## Screens and verification

Routes: `/attendance`, `/attendance/today`, `/attendance/history`, `/attendance/sessions/:id`, `/attendance/groups/:groupId`, `/attendance/students/:studentId`. The existing sidebar, forest/lime design, panels, controls and native dialogs are reused. Bulk present affects only unmarked students after confirmation. Saving and cancelling require confirmation; errors retain edits. History supports date/group filters and pagination; student links open student-specific summaries.

Automated attendance tests cover occurrence/record uniqueness, parallel creation and stale saves, bulk marking, corrections, explicit unmarked status, roster membership validation, enrollment intervals and snapshot retention, reassignment, teacher/tenant/platform isolation, mass assignment, CSRF, history, cancellation, timezone boundaries, dashboard coverage and formulas. React tests verify confirmations, selective submission, conflicts, role controls and empty states. Full workspace tests/typecheck/build and npm audit are required before PR completion.

Chromium checks use synthetic mocked API responses (not live tenant data): 320, 375, 390, 699, 700, 701, 768, 1024 and 1440px without horizontal overflow; keyboard marking, Escape dismissal, reduced motion and runtime errors. This does not replace live acceptance testing or a full screen-reader audit.

## Known limits

- Schedule/teacher changes made before Phase 4.1 cannot be reconstructed if the old values were overwritten. New changes preserve occurrence snapshots.
- Legacy removal times rely on existing membership timestamps. There is no fabricated enrollment or assignment history migration.
- A roster freezes at occurrence materialization. Later same-day changes require manager review; there is no automatic retroactive roster rewrite.
- Future attendance and a background occurrence-generation worker are outside this phase. History generation is on demand; large centers should select a group/shorter period when reaching report limits.
- Correction metadata retains the latest marker/time; this phase does not introduce a separate immutable per-edit audit ledger.

## Manual acceptance checklist

- [ ] Owner/admin: open Davomat, compare today's lesson cards to the weekly schedule in Tashkent time.
- [ ] Teacher: open an assigned lesson on mobile; verify only eligible group students appear.
- [ ] Confirm bulk Keldi; verify existing Kelmadi/Kechikdi/Sababli statuses remain unchanged.
- [ ] Save partially marked attendance; verify unmarked students stay unmarked and coverage is incomplete.
- [ ] Finish the roster, verify completed/awaiting dashboard counts and all status totals.
- [ ] Correct a saved status and note; verify history/student/group totals update without duplication.
- [ ] Open two browsers, save from one, then verify the other receives a conflict and retains its edits.
- [ ] Remove/re-enroll a student or edit a schedule; verify existing attendance history is preserved.
- [ ] Reassign a teacher through the supported schedule/group workflow; verify both teachers cannot access the prior teacher's historical attendance.
- [ ] Cancel/restore as manager; verify analytics exclusion/restoration and teacher denial.
- [ ] Check date filters, group filters, pagination, no-record, failed-request/retry and keyboard states.
- [ ] Verify another tenant and super admin cannot access attendance IDs; teacher finance remains forbidden.
- [ ] Recheck billing, payments, debts and financial reports against the previous release.

## Validation results (2026-10-30)

- Full regression: 189 API tests and 35 web tests, all passing (224 total).
- Root workspace typecheck: passed.
- Production build: passed for API and web.
- npm audit: zero vulnerabilities across all severities; no dependency changes.
- Chromium synthetic UI checks: nine viewport widths, no horizontal overflow or page errors; keyboard marking, Escape and reduced motion passed.
- `git diff --check`: passed.

No deployment or merge was performed. These results use local test databases and synthetic browser data; the manual checklist above remains for live tenant acceptance.

## Changed files

| Files | Change |
| --- | --- |
| `apps/api/src/attendance-models.ts` | Session/record schemas and tenant-scoped indexes |
| `apps/api/src/attendance-service.ts` | Occurrences, historical rosters and percentage formulas |
| `apps/api/src/attendance.ts` | Validated APIs, authorization, atomic writes and statistics |
| `apps/api/src/app.ts` | Authenticated router, bounded bulk parser and dashboard data |
| `apps/api/src/group-models.ts`, `groups.ts` | Enrollment end dates and historical query index |
| `apps/api/src/models.ts` | Startup attendance collection/index provisioning |
| `apps/api/src/schedules.ts` | Snapshot occurrences before schedule changes |
| `apps/api/tests/attendance.test.ts` | Replica-set integration/security/concurrency coverage |
| `apps/web/src/Attendance.tsx`, `Attendance.test.tsx` | Attendance screens and UI interaction tests |
| `apps/web/src/App.tsx`, `styles.css` | Role-aware navigation/routes, KPIs and scoped responsive styles |
| `packages/contracts/src/index.ts` | Shared attendance DTOs |
| `docs/phase-4.1-attendance.md` | Architecture, API, verification, limits and acceptance checklist |
