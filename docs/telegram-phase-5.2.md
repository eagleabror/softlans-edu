# Phase 5.2 — automated Telegram notifications

Baseline: latest main at `3bf2bc1c80293c3b07de2eb38406b6ba2256f1ba`, containing merged PR #17. Startup webhook registration, JWT cookies, origin/CSRF checks and Phase 5.1 staff account linking remain intact. No services, schedules, secrets or deployments are enabled by this change.

## Guardian authorization and consent

1. An owner verifies guardianship using the center's established offline identity/authorization process. A phone number alone is never accepted as proof by the application.
2. The guardian privately sends `/id` to the central bot and presents that Telegram ID to the owner during verification.
3. The owner selects the student, enters the guardian name and Telegram ID, and explicitly attests to verifying guardianship and account ownership. This attestation is audited. Admins can inspect/disconnect links, but cannot issue invitations or grant consent.
4. The invitation contains 256 random bits, expires in ten minutes, and stores only SHA-256. It is bound to tenant, student, guardian record and expected Telegram account. Reissuing a pending invitation rotates the hash; an already verified link must first be disconnected. A unique tenant/student/Telegram-ID index prevents duplicate recipients. Different verified guardians are supported.
5. A private `/start g_…` consumes the invitation inside the existing replay-protected MongoDB webhook transaction. It verifies active tenant/student and the exact Telegram account. It does **not** enable notifications.
6. `/consent <guardian-link-id>` explicitly opts that account into generic debt, attendance and lesson notices. Only that verified Telegram account can consent. `/stop` withdraws consent for all its guardian links and the existing staff integration; `/disconnect` removes guardian chat/link verification and invalidates invitations. `/debt_off`, `/attendance_off`, `/lesson_off` suppress individual categories. Reconnecting and consenting does not restore disabled category preferences; staff can also suppress but never enable recipient preferences.

The expected Telegram ID remains for authorization/reinvitation and is hidden from CRM API responses along with chat IDs and hashes. Bot replies disclose no student names, tenant names, balances, lesson details or guardian lists. The authorization record and consent actions are audited without message content.

## APIs

All routes below are under `/api/notifications`, authenticated with existing cookies and protected by existing write-origin checks. The server derives tenant scope exclusively from the principal. Unknown input fields are rejected. Admin link/history permission is explicitly granted in this policy; teachers and super admins are excluded entirely.

| Method | Route                        | Roles / behavior                                                               |
| ------ | ---------------------------- | ------------------------------------------------------------------------------ |
| GET    | `/settings`                  | Owner; defaults are disabled                                                   |
| PATCH  | `/settings`                  | Owner; full validated settings, audited                                        |
| POST   | `/invitations`               | Owner; verified guardianship attestation; 20/hour                              |
| GET    | `/guardians?studentId=…`     | Owner/admin; tenant student existence required, max 100 links                  |
| POST   | `/guardians/:id/disconnect`  | Owner/admin; revoke, invalidate invitations and queued revisions               |
| PATCH  | `/guardians/:id/preferences` | Owner/admin; only false values permitted                                       |
| GET    | `/history?page=1`            | Owner/admin; paginated, 20/page                                                |
| GET    | `/failed?page=1`             | Owner/admin; failed jobs, 20/page                                              |
| GET    | `/summary`                   | Owner/admin; counts by delivery state                                          |
| POST   | `/test`                      | Owner; fixed generic test, verified consenting guardian; 5/hour                |
| POST   | `/jobs/:id/retry`            | Owner; known retriable 429/500/502/503/504 only; 10/hour; attempts never reset |

All management routes additionally have a 60/minute limiter and the existing application API limiter. Limiters are process-local (existing express-rate-limit convention); multiple instances multiply request budgets. No unrestricted messaging, public guardian lists, or public processor HTTP endpoint is provided. History returns metadata and safe error codes only, never chat IDs, tokens or message bodies.

## Data and indexes

New Mongoose models (registered with startup `ensureIndexes`):

- `GuardianLink`: tenant, student, authorizing owner, guardian name, hidden expected Telegram ID/chat ID/token hash, expiry, verification/consent/withdrawal timestamps, preferences and revocation revision. Unique sparse token hash; unique tenant/student/account; account/verification lookup.
- `NotificationSettings`: one unique row per tenant, categories, debt offsets `[-3,0,3,7]`, lesson timings `[24,1]`, late/excused/corrections, quiet hours, Uzbek/Russian language and optional plain-text templates (500 characters, no interpolation).
- `AttendanceEvent`: transactional outbox with tenant/student/session/revision, explicit status and correction flag; unique tenant/session/student/revision and tenant/student/createdAt lookup.
- `NotificationJob`: tenant/student/guardian, source event references, timing/version, recipient revision, status, attempts, next attempt, lease/fencing token, safe attempt codes/timestamps, sent timestamp. Unique tenant/event key; status/nextAttemptAt; status/leaseUntil; tenant/history indexes.
- `NotificationAudit`: tenant/actor/target IDs, fixed operation names and timestamps; tenant/createdAt index. Bot audit operations have no CRM actor ID.

No message bodies, student names, financial amounts, Telegram API error descriptions or bot credentials are stored in jobs/audits. Existing `TelegramUpdate` provides update-ID uniqueness and seven-day replay retention, plus private-chat and command-age checks. Existing `TelegramDispatch` coordinates bot pacing across both delivery systems. Notification records are retained until an operator applies a center-approved retention policy; automatic deletion is intentionally absent so it cannot erase event deduplication evidence unexpectedly.

## Delivery architecture

Attendance mutations create outbox events **inside the same transaction** as attendance records. No event is visible to the planner until commit. Only actual status changes produce an event; unmarked roster members never generate absence alerts. Delivered messages are never deleted or edited. With corrections enabled, a new generic update is queued; obsolete undelivered events are suppressed using the latest student/session event. Cancellation suppresses pending attendance notices.

The independent planner traverses enabled tenants/verified consenting guardians with cursors, then idempotently upserts jobs. Debt event dates use Asia/Tashkent and the existing transactionally reconciled charge `paidAmount` cache, so fully paid/cancelled charges are suppressed and reversals can restore eligibility. Source validity and balance are checked again before sending. The debt event key includes charge/due-date/offset/guardian, preventing repeat sends for that event.

Recurring active schedules project upcoming occurrences over today plus two days; future lesson sessions are not fabricated. An existing session's cancellation, roster and start time take precedence. Active group, applicable recurrence, schedule version and active enrollment are rechecked. Schedule edits invalidate older jobs. Dates use explicit `+05:00` lesson instants and `Asia/Tashkent` local calendar calculations. Reminder jobs catch up at most one hour after the configured lead time and never after class starts. Quiet hours defer all categories without spending delivery attempts; midnight wrapping is supported and equal start/end disables quiet hours. A deferred debt reminder expires after its event date; a deferred lesson reminder expires at class start.

Each worker takes a MongoDB atomic global bot permit and atomically claims one job with a UUID lease and 60-second deadline. Before the external call it checks consent, link revision, active tenant/student, category settings, source eligibility and quiet hours, then verifies its fence and increments the attempt count. Default Telegram client timeout is ten seconds. Attempts are capped at five; explicit 429/5xx responses use bounded exponential backoff with `retry_after` and persisted global pacing. Blocked/invalid chats disable the recipient. Failures before sending requeue with a bounded budget. Unclassified network failures, expired send leases and ambiguous results become `UNKNOWN_OUTCOME`; these cannot be manually retried through the CRM. Known failures are owner-retriable without resetting the budget.

### Remaining atomicity risks and reconciliation

Telegram `sendMessage` has no transactional/idempotent relationship with MongoDB. If Telegram accepts a message and the process loses its response or cannot commit `sent`, delivery is ambiguous. The system preserves unknown outcomes and suppresses automatic/manual retries rather than pretending exactly-once delivery. Inspect safe attempt timestamps and recipient confirmation outside the CRM before any exceptional operator recovery. Do not clear unique job keys or recreate unknown-outcome jobs to force resend. A lease fence prevents a worker from starting a send after losing ownership, but cannot cancel an API request already in progress. Explicit Telegram 5xx retries can still duplicate a message if Telegram performed the side effect before returning an error. Consent/payment/schedule changes can also race the final network request; already accepted messages cannot be withdrawn. Generic content limits disclosure in these unavoidable windows.

## Scheduler setup — no paid services required

Production does not run a `setInterval` notification loop. Run this independently from a trusted scheduler:

```sh
npm ci
npm run telegram:automation -w @softlans/api
```

Use Node 22.12+ and the same release/lockfile as the web service. Supply configuration through the scheduler's secret store: `MONGODB_URI`, `JWT_SECRET`, `APP_ORIGIN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`, plus any required existing configuration. Never put values in workflow source, command arguments, logs or a PR. The script does not register webhooks or listen publicly. It verifies the replica set and indexes, plans eligible events, then processes jobs for up to 45 seconds with awaited pacing; it exits and disconnects. Overlap is protected by database claims. Schedule at least every minute for useful one-hour lead times; per-invocation send throughput is deliberately conservative. Do not simultaneously run a competing legacy dispatch schedule unless staff delivery is needed; both share bot pacing.

**Render Free web service:** Render Free does not provide a free persistent worker/cron runtime. Do not configure a paid Render worker or cron job automatically. Use an external scheduler capable of executing the command (for example a trusted self-hosted cron runner). A standard cron entry on that host can invoke a wrapper every minute:

```cron
* * * * * /opt/softlans/run-telegram-automation >> /var/log/softlans-notifications.log 2>&1
```

The wrapper should `cd` to the checked-out release and execute `npm run telegram:automation -w @softlans/api` using secret-store-provided environment variables. Install dependencies once per release, not once per minute. Restrict runner and log permissions. Allow only the runner's stable outbound IP in Atlas; do not open Atlas to the Internet. Run against staging first, review the resulting job summary/history, then explicitly configure the production schedule through your normal deployment process. A cold/sleeping Free web service does not stop an external MongoDB planner, but it can delay guardian webhook/attendance requests. GitHub hosted Actions schedules have minimum five-minute cadence and may be delayed; use them only if that delivery delay is acceptable, with repository secrets and an explicit concurrency policy. No scheduler has been provisioned by this PR.

## Known limits

- Offline verification quality is the owner's responsibility; the app records an explicit attestation and proves control of the expected Telegram account, not legal guardianship by itself.
- Debts catch up on their event date; attendance catches up for seven days; lesson lead times catch up within one hour. Longer outages deliberately miss stale reminders. Quiet hours can suppress a lesson entirely when class starts before quiet hours end.
- Planner scans are cursor-based but traverse enabled guardians and recent attendance events on each run. Large tenants should add incremental planning checkpoints and measured batch sizing before increasing scale. The scheduler checks its 45-second processing deadline after planning; planning itself can take longer.
- No dynamic financial details, attachment delivery, bulk send, daily owner reports, subscription billing, payment gateways or unrelated CRM modules.
- Notification retention requires a documented operational policy. Retryable 5xx errors and external-call races remain best effort, not exactly once.
- Browser visual checks on physical/mobile viewports and real Telegram delivery require manual staging validation. Automated tests do not prove visual quality or real Telegram availability.

## Manual staging checklist

- [ ] Existing Phase 5.1 staff link/disconnect and startup webhook registration still work.
- [ ] Teacher/super-admin cannot open notification management APIs or navigation; admin sees links/history but cannot issue invitations, edit reminders, test or retry.
- [ ] Owner selects a tenant student, independently verifies guardian identity and Telegram `/id`, then issues an invitation.
- [ ] Expired, forwarded, superseded and reused invitations fail without leaking student details.
- [ ] Link alone leaves consent disabled; `/consent <id>` enables, `/stop` suppresses queued jobs, `/disconnect` invalidates links. Link two different guardians to one student.
- [ ] Configure each debt offset; partially paid debt sends a generic reminder once; paid/cancelled debt is suppressed; reverse a payment before processing and verify eligibility.
- [ ] Mark absent/late/excused, repeat unchanged input, correct attendance, cancel the session; verify configured alerts and no unmarked/duplicate alerts.
- [ ] Configure 24h/1h lesson reminders, reschedule/cancel, deactivate schedule/group, remove membership; verify pending obsolete jobs cancel.
- [ ] Test midnight and overnight quiet hours in Tashkent; no sends during quiet hours.
- [ ] Run two processors concurrently; restart during a send; verify lease/unknown-outcome status, attempts and deduplication.
- [ ] Simulate 429/5xx/403/invalid chat in staging mocks; verify retry deadlines, terminal limits and recipient disablement.
- [ ] Check overview, settings, guardian selection, confirmations, empty/error/loading/history/pagination using keyboard and at 320/390/700/768/1024/1440px; check zoom, focus and reduced motion.
- [ ] Verify tenant isolation with two centers and no tokens, identifiers or confidential message content in logs/browser responses.

## Validation report

- Full `npm test`: 262 API tests across 17 files and 51 web tests across 11 files passed, including existing Phase 1–5.1 regressions. There are 20 new notification integration tests and four new UI tests.
- `npm run typecheck`: passed across workspaces.
- `npm run build`: passed across workspaces (Vite production build included).
- `npm audit --json`: zero vulnerabilities at every severity.
- `git diff --check`: passed.
- Early validation found a JSX fragment/type error in the new navigation; it was corrected before the passing full checks. No outstanding automated failures.
- Integration tests use local MongoDB 7.0.24 replica sets, authenticated HTTP clients and mocked Telegram sends. No production database, real Telegram send, production environment change, deployment or paid service was used. Physical/browser viewport, focus/contrast and real Telegram delivery checks remain manual.

## Changed files

- `apps/api/src/notification-models.ts`: guardian/settings/outbox/job/audit schemas and indexes.
- `apps/api/src/guardian-webhook.ts`: account-bound invitations and explicit recipient consent/withdrawal.
- `apps/api/src/notification-api.ts`: validated tenant management/history/test/retry/summary APIs.
- `apps/api/src/notifications.ts`: planner, eligibility checks, quiet hours and durable leased worker.
- `apps/api/src/scripts/telegram-automation.ts`: independently invokable cron processor.
- `apps/api/src/attendance.ts`: transactional status-change outbox.
- `apps/api/src/telegram.ts`: guardian commands within existing replay-protected webhook.
- `apps/api/src/app.ts`: authenticated notification router mount.
- `apps/api/src/models.ts`: startup index registration.
- `apps/api/package.json`: automation command.
- `apps/api/tests/notifications.test.ts`: queue/security/reminder integration tests.
- `apps/web/src/Notifications.tsx`: Uzbek overview, links, reminders and history tabs.
- `apps/web/src/Notifications.test.tsx`: role visibility, settings, invitation prerequisites and error states.
- `apps/web/src/App.tsx`: permission-aware navigation and route.
- `apps/web/src/Telegram.tsx`: retain personal linking with updated explanatory copy.
- `docs/telegram-phase-5.2.md`: API, architecture, operational limits, scheduler setup, validation and manual checklist.
