# Phase 6.6.2 — Automated monthly teacher payroll drafts

Only drafts are generated. Approval and salary payouts remain explicit owner
operations in the existing payroll flow. No production data or external payment
service is needed for verification.

## Closing-period policy

- Payroll month is a **calendar month in Asia/Tashkent (UTC+05:00)**, with a
  half-open interval `[month start, next month start)`. Open/future months are
  rejected by the batch generator.
- Default automatic close is **the first day of the next month at 00:15**.
  `PAYROLL_CLOSE_DAY` (1–28) and `PAYROLL_CLOSE_TIME` (HH:mm) set an optional
  grace period in the following month. The timezone is deliberately fixed.
- `.github/workflows/payroll-monthly.yml` polls every 15 minutes. At defaults the
  due instant is 19:15 UTC on the final calendar day of the payroll month,
  including February and December. GitHub schedule delays are possible: this is
  an eventual closing job, not a guaranteed real-time deadline. Arbitrary close
  minutes run on the next poll. Operators can change poll cadence separately.
- Default selection is the **previous Tashkent month**, pinned across every page
  of a run, even if the clock crosses another month. Polls catch up within the
  following month. After longer downtime explicitly select the missed month in
  workflow dispatch, CLI, or the owner fallback. There is no unbounded historic
  backfill at startup.
- Eligibility is an **active teacher account in an active tenant at generation**.
  This uses current account eligibility, not a reconstructed historical roster.
  Every eligible account is checked, including teachers with no groups. A missing
  effective salary rule is an exception, not a zero salary. Inactive teachers are
  excluded; owners can use the existing individual payroll workflow for a former
  teacher after reviewing historical eligibility.
- Salary rules are selected at the payroll month's first local date. Fixed salary
  is monthly, without tuition proration. Group overrides replace the default for
  that group; a teacher fixed default applies once, as in the existing engine.
- Billed percentage uses non-cancelled charges' **actual `finalAmount`** for the
  billing month, including Phase 6.6.1 proration and discounts. It never rebuilds
  tuition from nominal group fees. Collected percentage uses payments with
  `paidAt` inside the payroll month, linked to non-cancelled attributed charges,
  excluding payments with a `PaymentReversal`. A January charge paid in February
  belongs to February collected payroll. Payment receipt time, not billing month
  or record creation time, determines collected payroll.
- Calculations are snapshots as of each draft's generation, using the existing
  engine's whole-UZS half-up rounding and charge teacher attribution. Legacy
  unattributed charges retain the existing current-group attribution warning.
  A later backdated payment, charge correction or reversal does **not** silently
  rewrite drafts or approved payroll. The owner explicitly recalculates a draft
  with a reason and current revision; existing adjustments survive. Approved
  history requires the existing reversal/correction workflow, never an automatic
  edit. Review late changes before approving.

## Durability and safe retries

`Payroll` retains its unique `(tenantId, teacherId, payrollMonth)` index. Each
teacher is processed in a MongoDB transaction under the existing tenant billing
lock, shared with manual drafts, salary rules, adjustments and payouts. Draft,
audit and `PayrollRunItem` are committed together. Existing payroll always wins,
regardless of status, adjustments, reversal state or generation source. No salary
payout collection is written by automation.

`PayrollRun` has a unique tenant/month key. `PayrollRunItem` has a unique
tenant/month/teacher key and stores ready/exception status, teacher name, payroll
reference and actionable code/message. Expected configuration/report-limit
exceptions are durable and do not block other teachers. Infrastructure failures
reject the request; they are not reported as successful zero drafts. A retry can
start at the beginning or replay the same cursor after timeout/restart. Corrected
settings replace the exception on retry. If a failing teacher is deactivated or
changes role, the result is retained as an explicit `excluded` item; it no longer
blocks readiness for the remaining eligible teachers. Successful existing drafts are preserved.

Each batch handles at most ten teachers in one tenant. The scheduler traverses
active tenants using `{ tenantId, afterTeacher? }` cursors. Completed automatic
runs are skipped on future polls. Manual fallback can scan again intentionally
(e.g. a newly reactivated teacher); it still never recalculates existing payroll.
A teacher created/reactivated after an automatic run completed needs this manual
scan. New teachers added during a scan can require a new scan if their ID sorts
before the current cursor. No process-local lock or accepted background task is
required. Default MongoDB majority commits and snapshot reads are used. Run
`ensureIndexes` through normal application startup before using the endpoints;
no destructive migration or historical rewrite is needed.

## Authenticated scheduler

Set a unique `PAYROLL_SCHEDULER_SECRET` of 43–128 base64url-compatible characters.
It must differ from JWT, billing, notification, MFA, operator, password-email and
bot/webhook credentials. Do not put secrets into URLs, logs or repository files.
The route is disabled (503) if unset. Neither CRM cookies nor query-string
credentials authorize it.

`POST /api/internal/payroll/run`, JSON body, Bearer authorization:

```json
{"month":"2026-10","cursor":{"tenantId":"0123456789abcdef01234567","afterTeacher":"0123456789abcdef01234568"}}
```

Both fields are optional on the initial call. Follow `nextCursor` until null and
send the returned `month` unchanged. **Only HTTP 200 plus a validated batch body
is a completed batch**. `processing` requires another cursor; `exceptions` needs
operator action; `not_due` means no work was due. A final null cursor is not enough
if any batch reported exceptions. HTTP 202, redirect, malformed JSON, network
failure or timeout is never proof of completion. Replaying is safe.

The supplied opt-in workflow validates this protocol, retries transient HTTP and
network failures with pacing, rejects 202, detects repeated cursors, traverses
remaining tenants despite business exceptions, and fails the job if any exceptions
remain. Set repository variable `PAYROLL_SCHEDULER_URL` to the HTTPS endpoint and
repository secret `PAYROLL_SCHEDULER_SECRET` only after reviewing the deployment.
This change does not set them, deploy, or activate a production scheduler.

CLI alternative (same closing policy, cursor traversal, nonzero exit on failure):

```sh
PAYROLL_MONTH=2026-10 npm run payroll:monthly -w @softlans/api
# Development with an explicitly chosen disposable replica set:
PAYROLL_MONTH=2026-10 npm run payroll:monthly:dev -w @softlans/api
```

Normal application configuration is required. CLI credentials grant database
access and belong only on a trusted operator host. Avoid simultaneous manual CLI
runs when investigating failures; database idempotency still protects replays.

## Owner review and manual fallback

In **O‘qituvchilar maoshi**, select a closed month and use **Oylik qoralamalarni
yaratish**. The browser follows all teacher cursors and shows verified final
status, exceptions and links to salary settings. It never interprets an accepted
response as completion. If interrupted, refresh status and retry the same month.
The owner can run immediately after month end, before a configured automatic grace
period expires; this is an intentional early close override.

- `POST /api/payroll/automation/run` accepts `{month, confirmed:true,
  afterTeacher?}`; tenant comes exclusively from the authenticated session.
- `GET /api/payroll/automation/status?month=2026-10&page=1` returns run status and
  paginated teacher results (20 per page), scoped to the owner tenant.
- Existing teacher statements stay limited to that teacher's approved payroll.
  Admins, teachers and platform super admins cannot run or inspect this batch UI.
  Existing authentication, subscription, MFA and same-origin JSON write checks
  remain in place for the fallback.
- Review includes teacher/month, calculation methods, group names and bases,
  gross salary, adjustment reasons/sums, final salary and draft/approval status.
  Approval still requires the existing explicit confirmation dialog.

Exceptions: `NO_SALARY_RULE`, `GROUP_SALARY_RULE_REQUIRED`,
`INVALID_SALARY_SETTINGS` (including overlapping or unusable persisted rules),
`INVALID_TEACHER_SETTINGS`, `PAYROLL_OWNER_REQUIRED`, `TOTAL_LIMIT` and
`REPORT_LIMIT`. A tenant without an active owner records a run exception and the
scheduler continues to the next tenant. Fix settings and replay; never add a
placeholder zero rule merely to clear an exception. A valid explicit zero rule or
a valid percentage rule with no transactions can legitimately produce zero.

## Owner notifications

Completed run status is always available in the authenticated owner interface.
When all eligible teachers are ready, a `payroll_ready` job is committed to the
existing `NotificationJob` outbox with the run completion transaction. Unique
month/owner keys prevent duplicate readiness jobs on retries. No job is queued if
any teacher is still pending or has an exception. The message contains only the
month and a review prompt, no salary amounts or student data.

Existing connected-owner Telegram consent is required. Recipient role, active
tenant/user, integration revision, current consent and completed run are checked
again at delivery; tenant quiet hours (default 21:00–08:00) are honored. Existing
notification automation/dispatch must be operational to deliver the outbox. Payroll
readiness and delivery are separate statuses: a ready payroll is not proof of a
sent message. Disconnected/opted-out owners receive no external message. Consent
obtained after a completed run requires an intentional manual scan to enqueue
that month's notification. Existing delivery leases, retry limits, uncertain-send
policy and failure diagnostics apply unchanged.

## Verification

Actual command output, dependency audits and desktop/mobile screenshots are in
[`artifacts/phase-6.6.2`](../artifacts/phase-6.6.2/README.md). Capture script:
`npx tsx scripts/phase-6.6.2-capture.mts` after the build and the existing
`scripts/redesign` Playwright install. It creates synthetic users, charges, rules
and an isolated replica set, uses the real API/frontend, and asserts no approval
or payout occurred. It never loads a production URI or sends Telegram messages.
