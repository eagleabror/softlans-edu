# Phase 5.3 — Daily owner Telegram reports

Based on main `4886dc3` (merged Phase 5.2). No deployment, Render configuration,
credentials, billing integration, or guardian messaging features are introduced.

## Behavior and period

Each enabled, connected, opted-in business owner receives one aggregate report per
Tashkent calendar date and tenant. Default time is 20:00, timezone fixed to
Asia/Tashkent. Each owner selects students, finance, attendance and/or payroll.
The Uzbek page is `/daily-reports`. Telegram linkage and global recipient opt-out
remain on `/settings/telegram`; `/stop` and disconnect retain their existing behavior.

The report stores `createdAt`, `period.start`, exclusive `period.end`, `period.asOf`
and timezone. A day is `[00:00+05:00, next 00:00+05:00)`. Reports are today's data
**through creation time**, not a promise of a complete day at 20:00. Transaction
queries cap at `asOf`. Current balances reflect the generation snapshot; reports
are immutable after enqueue. Preview is a newly generated snapshot. Quiet hours
can defer delivery of the original snapshot. History retains that original date.

## Formulas

All monetary inputs are integer UZS. Existing ledger, reversal filtering,
attendance, schedule materialization and safe-total helpers are reused. Generation
uses a MongoDB snapshot transaction and existing scheduling-then-billing lock order.
Totals outside the safe integer range fail rather than sending rounded money.

- Active students: tenant Student documents with status active, never memberships.
- Enrolled today: enrollmentDate falls in the Tashkent day (the existing API stores explicit
  date-only inputs at UTC midnight, 05:00 Tashkent; omitted dates default to an instant). This represents
  enrollment date, not database account creation time.
- Archived today: latest recorded transition to archived in today's instant window.
  New archive actions and creation in archived status set archivedAt. If the tenant
  has legacy archived records without timestamps, this count is unavailable (`—`)
  instead of inventing dates. Multiple archive transitions for one student are not
  an event-history metric; the last transition is counted once.
- Daily receipts/count/methods: payments with paidAt in today's window through asOf,
  no reversal, and a matching tenant/student non-cancelled charge. Charge billing
  month does not determine receipt date. Methods: cash, bank transfer, manual Click.
- Current debt: sum max(0, finalAmount minus valid paid amounts capped per charge),
  non-cancelled charges through the current billing month, all older months included.
  Overdue uses the existing ledger's Tashkent whole-day aging (`days > 0`), so due
  today is not overdue. Reversals and cancellations reflect current snapshot state.
- Scheduled lessons: non-cancelled persisted sessions for the date, materialized
  from existing active schedules using the existing roster and schedule service.
  Completed lessons: that set with completed status. This counts all today's lessons,
  including lessons later than creation time. Cancelled sessions are excluded.
- Attendance: tenant-scoped records belonging to those sessions and their rosters.
  Present, absent, late, excused are student-lesson counts. Expected = sum roster
  sizes, marked = present + absent + late + excused; unmarked = expected - marked.
  Coverage = marked / expected × 100. Attendance = (present + late) / marked × 100,
  **including excused in the denominator**, matching the existing attendance service.
  Missing denominator yields null / `—`, zero numerator with nonzero denominator is 0%.
- Approved monthly salary: finalSalary for current-month approved, partially_paid,
  or paid payrolls, excluding reversed payrolls. No draft calculations included.
- Daily payouts: unreversed salary payouts today through asOf on approved payrolls.
- Current payroll liabilities: sum max(0, approved finalSalary minus unreversed
  payouts through asOf) per payroll across **all months**. Uses actual payout ledger,
  not the paidAmount cache. No new salary calculation rules are introduced.

## API and security

All paths have `/api/daily-reports` prefix. Cookie authentication, active-tenant
checks and existing Origin/JSON write protection apply. Business owner only;
admin, teacher and super admin receive 403. Filters derive tenantId and userId
from the authenticated principal. No endpoint accepts a recipient/tenant override.

| Method/path | Result |
| --- | --- |
| GET `/settings` | Settings and safe availability/connection/opt-in booleans |
| PATCH `/settings` | Full validated settings; increments revision and audits action |
| GET `/preview` | Current aggregate report and saved-section Uzbek preview |
| GET `/history?page=1` | Own jobs, 20/page, safe status fields |
| GET `/history/:id` | Own snapshot, status, attempts and safe error codes |
| POST `/test` | Empty JSON; enqueue own test, 202 does not mean delivered |

Settings: enabled boolean, time HH:mm, timezone Asia/Tashkent, distinct nonempty
sections array (students/financial/attendance/payroll), quietStart/quietEnd HH:mm.
Equal quiet boundaries disable that quiet window. Both owner and tenant Phase 5.2
quiet windows apply. Test reports require explicit Telegram opt-in, but can be
requested while automatic reports are disabled; limited to one test/date/owner.
Settings and test requests are audited. Requests have rate limits.

Owner job contents/statuses are excluded from the guardian notification history,
summary and retry APIs, which admins can access. Responses never include chat IDs,
bot tokens or Telegram account identifiers. Reports contain no individual identities.

## Durable scheduling and operations

Use the **existing Phase 5.2 external scheduler**, with the same command:

```sh
npm run telegram:automation -w @softlans/api
```

Recommended trigger: every minute (`* * * * *` in UTC). No web-server timer is
installed. Run from the repository root after `npm ci`, with existing trusted
MongoDB/Telegram environment configuration and Atlas network access. Do not
change Render secrets to enable this feature. No scheduler or paid resource was
provisioned by this PR. `ensureIndexes()` creates the new settings and existing
job uniqueness indexes before planning. Deploying the application also registers
these indexes through the existing startup path.

The command plans due owner reports, plans existing guardian jobs, then drains the
shared queue for up to 45 seconds using the existing bot pacing and bounded retries.
Cursor traversal covers settings. Run frequency and shared queue capacity determine
actual delivery latency; monitor backlog. Concurrent planners may perform redundant
snapshot work but the unique `(tenantId, key)` index produces only one durable job.
Key: tenant + user + owner_daily/owner_test + Tashkent date. Jobs use the existing
atomic claim, lease fence, retry counter, attempt log and global TelegramDispatch
rate limit. Terminal keys are not regenerated, including cancelled jobs.

Catch-up: only today's due report is generated after a missed run; no reconstruction
of older dates. Pending reports expire eligibility after 24 hours. Owner/tenant
active status, owner role, integration revision and opt-in, settings revision,
automatic enable flag and quiet hours are rechecked before send. Changing settings
cancels queued reports with old revisions; today's key remains consumed, and the
new settings take effect for the next report. A test has a separate daily key.
Persisted jobs survive restarts. No new in-memory timer determines report delivery.

### External delivery uncertainty and reconciliation

MongoDB and Telegram have no shared transaction or sendMessage idempotency key.
Exactly-once external delivery cannot be guaranteed. A transport timeout, lost
acknowledgement or expired sending lease becomes terminal UNKNOWN_OUTCOME, with
no automatic retry. Explicit Telegram 429/5xx responses use the existing bounded
backoff (up to five attempts); 5xx can still have uncertain external side effects.
Telegram 400/403 opt the owner out to stop further automatic delivery attempts.
There remains a race between eligibility checks, lease expiry/revocation and the
external API call; the lease fence reduces but cannot eliminate it.

Reconcile UNKNOWN_OUTCOME by comparing the owner's actual Telegram message/date
with the job's creation/sent time and attempt log. Keep the daily key terminal;
do not reset/delete the job or blindly resend. A separately labelled daily test
may be explicitly requested by the owner if needed, acknowledging possible duplicate
information. No public owner-job retry or bulk-send endpoint is added.

## Changed files

- New API files: daily-report-models.ts (owner preferences/index), daily-reports.ts
  (snapshot, formatter, eligibility, planner), daily-report-api.ts (owner endpoints).
- Existing API: app.ts route registration, models.ts/indexes and archive timestamp,
  students.ts archive tracking, analytics.ts exported validPayments helper,
  notification-models.ts owner job variant, notifications.ts shared delivery,
  notification-api.ts privacy filtering, scripts/telegram-automation.ts planning.
- Web: DailyReports.tsx, DailyReports.test.tsx, App.tsx owner route/navigation,
  styles.css scoped responsive form/preview styles.
- Tests: apps/api/tests/daily-reports.test.ts; this document.

## Validation and limitations

Full `npm test`: 286 API tests and 55 web tests passed. `npm run typecheck`,
`npm run build`, and `git diff --check` passed. `npm audit`: zero vulnerabilities.

New integration coverage: report/date boundaries; valid daily payments, reversal and
cancelled charge exclusion; debt; incomplete attendance; payroll/payout reversal;
concurrent scheduler and worker execution; disconnected owner, opt-out, role removal,
disabled tenant/settings; quiet hours; Telegram 429/500/403/unknown outcome; RBAC,
tenant isolation, CSRF and safe response contents. UI tests cover save, sections,
preview, test enqueue, disconnected state, errors/retry and uncertain delivery.

Local replica-set tests and mocked Telegram only; no real financial data or messages.
Snapshot generation materializes today's attendance sessions, just as existing
attendance views do. High-volume tenants should measure report transaction duration
and memory (daily rosters/records and approved payrolls are loaded per tenant).
No new historical enrollment/archive audit trail, historical balance reconstruction,
report retention policy, or dedicated per-owner queue capacity is introduced. Jobs
and snapshots follow the existing Phase 5.2 job retention behavior. UI visual,
real Telegram, mobile viewport and screen-reader verification remain manual.

## Manual staging checklist

1. Log in as owner, link Telegram, explicitly enable recipient notifications.
2. Open Kunlik hisobotlar; check disconnected/opted-out states and Telegram settings link.
3. Save 20:00, Asia/Tashkent, selected sections and quiet windows; refresh to verify persistence.
4. Preview against actual tenant receipts, debt ledger, attendance and approved payroll.
5. Verify all sections off is rejected; invalid time/timezone and cross-tenant IDs are rejected.
6. Request test; verify 202/navbatda then run existing automation command and refresh history.
7. Repeat test and scheduler runs; verify one key per recipient/date/type and no repeated send.
8. Verify owner and tenant quiet hours defer sends; check midnight/date labels and empty data.
9. Disconnect, /stop, remove owner role or disable tenant between enqueue and processing;
   confirm cancellation and no send. Reconnect requires a fresh eligible future job.
10. Verify admin/teacher/super-admin and other owners cannot fetch report contents or statuses;
    guardian history/summary must not include owner reports. Inspect network responses for secrets.
11. Simulate Telegram 429/5xx and transport timeout in staging; inspect safe status and reconcile
    UNKNOWN_OUTCOME without blind retries. Restart runner between enqueue and delivery.
12. Keyboard and 200% zoom; inspect 320, 390, 700, 768, 1024 and 1440px layouts, readable
    long Uzbek text, local table scroll, focus rings and all loading/error/empty states.
