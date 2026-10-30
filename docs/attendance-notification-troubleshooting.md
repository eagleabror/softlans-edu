> Follow-up: the optional authenticated HTTP trigger now permits an external scheduler to invoke the existing Render Free web service. See [phone-friendly setup](render-free-notification-scheduler.md). The historical investigation below describes the deployment before that follow-up; no scheduler was configured automatically.

# Missing guardian attendance notifications: investigation and verification

## Observed deployment and confirmed defects

Read-only inspection on 2026-10-30 confirmed:

- Demo `softlans-edu-demo` runs on Render **Free**, branch `main`, live deploy commit `d0acfc91cb6a05a41d5d4ffa997f05204e8cf2c2` (PRs #18 and #19 included).
- The service starts `npm start -w @softlans/api`. That starts only the HTTP server. Startup webhook registration receives Telegram updates; it does **not** plan or send attendance notifications.
- The build runs `npm ci --include=dev && npm run build && npm prune --omit=dev`.
- The confirmed workspace has no worker or cron service for this repository. The only repository workflow is CI, without scheduled execution. An independently configured external scheduler cannot be discovered from these sources; its existence/configuration remains unverified unless the operator confirms it.
- Current filtered application logs showed startup/webhook markers, with no processor markers. The old processor emitted no success markers, so absence of logs alone does **not** prove that an external invocation never happened.

Two defects were reproduced from the deployed source:

1. **Existing mark changed to absent was suppressed:** the attendance write correctly records `correction=true` whenever any earlier mark exists. The eligibility function gated _every_ such event on the optional `corrections` setting (default false), so `present → absent` generated no job despite attendance alerts being enabled. The fix always applies the configured absent/late/excused policy to the new status. The separate correction toggle controls other correction-only updates, such as `absent → present`. Tenant and recipient opt-out still override both.
2. **Documented production processor required a removed dependency:** `telegram:automation` used the development-only `tsx` executable, but Render prunes dev dependencies. Running that command inside the production artifact could not start the planner. It now executes compiled JavaScript; local source execution has a separate `telegram:automation:dev` alias.

A further confirmed coupling was removed: daily-report planning used to run before guardian planning/delivery without isolation, so a report planning exception would stop unrelated attendance delivery. Both planners now run independently, and the worker is still attempted after a planning failure; the invocation records failure and exits nonzero for operator visibility.

These findings do not establish that Telegram itself is broken. No production attendance, guardian/consent rows or credentials were retrieved, and no real Telegram messages were sent during the investigation. A particular historical student's exact suppression reason cannot honestly be claimed without tenant-authenticated diagnostics or operator verification.

## Complete flow

1. `PATCH/POST /api/attendance/sessions/:id/attendance` validates authenticated tenant, role, session revision and roster.
2. It updates attendance and creates one `AttendanceEvent` per **changed** status in the same MongoDB transaction. Rollback exposes neither record nor event. Unmarked students and unchanged re-saves generate no new absence event.
3. A separate invocation of `planNotifications` scans enabled tenant settings and active students with verified, explicitly consenting, enabled guardians. Each guardian's attendance preference must be enabled. Staff Telegram integration and parent phone/contact fields do not establish a guardian link.
4. The planner creates a unique guardian/event job. This does not happen inside the attendance request or Telegram webhook. A successful attendance HTTP response only confirms the saved attendance/outbox.
5. A scheduled automation invocation claims jobs atomically. It rechecks consent/revision, source validity, latest attendance event, tenant settings, active student, session cancellation and quiet hours.
6. Telegram sends use the existing central bot. 429/5xx retry within the bounded budget; invalid/blocked recipients are disabled. Ambiguous network/send-lease outcomes remain non-retriable `UNKNOWN_OUTCOME`; never clear idempotency keys to force a resend.

Without an invoker for steps 3–6, correctly saved attendance produces no Telegram delivery. Merging a PR, deploying the API, registering a webhook or calling `/api/health` does not install or run a scheduler.

## Safe diagnostics

Owner-only, cookie-authenticated endpoint:

```text
GET /api/notifications/diagnostics
GET /api/notifications/diagnostics?studentId=<tenant-student-id>&sessionId=<tenant-session-id>
```

Both target parameters are required together. IDs are validated and checked against the authenticated tenant and session roster; tenantId is never accepted from the client. Admin, teacher, super-admin and unauthenticated requests cannot use this endpoint. Responses contain only fixed reason codes, booleans, counts and processor timestamps. They expose no names, source IDs, Telegram IDs, tokens, message bodies, notes or financial details. Do not put live query URLs in public logs or support tickets.

The generic response includes `telegramConfigured` (configuration syntax/presence, **not** a real API connectivity check) and processor mode/state/stage/timestamps. `never_seen` means no heartbeat has been observed since this instrumented release, not proof no older runner ever existed. `recent` means a heartbeat within three minutes, not that every job was delivered. Inspect `stage`, `lastFailedAt` and `lastCompletedAt`; a failed run can retain an earlier successful completion timestamp. A five-minute external cadence will legitimately appear stale between runs.

Attendance reason codes:

| Code                                                       | Action                                                                                                                  |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `TELEGRAM_NOT_CONFIGURED`                                  | Operator checks the existing bot configuration in its secret store; do not paste values into diagnostics/logs.          |
| `NO_ATTENDANCE_EVENT`                                      | Confirm an actual changed attendance status was saved and committed on this release.                                    |
| `TENANT_ATTENDANCE_DISABLED`                               | Owner enables attendance alerts in Telegram xabarnomalari → Avtomatik eslatmalar.                                       |
| `NO_VERIFIED_GUARDIAN`                                     | Complete the account-bound guardian invitation. A staff bot account or phone field is insufficient.                     |
| `NO_GUARDIAN_CONSENT`                                      | Guardian sends the exact `/consent …` command shown by the bot. Staff cannot grant consent.                             |
| `RECIPIENT_ATTENDANCE_DISABLED`                            | Respect recipient opt-out. Do not force enablement to debug a send.                                                     |
| `ATTENDANCE_POLICY_DISABLED`                               | The latest event is a status whose alert/correction policy is disabled.                                                 |
| `WAITING_FOR_PLANNER`                                      | Committed eligible event has no job: inspect/start the external runner after explicit operational authorization.        |
| `QUIET_HOURS`                                              | Pending delivery is currently inside Asia/Tashkent quiet hours.                                                         |
| `DELIVERY_PENDING` / `DELIVERY_IN_PROGRESS`                | Inspect processor heartbeat and tenant-scoped history for progress.                                                     |
| `DELIVERED` / `DELIVERY_FAILED` / `DELIVERY_CANCELLED`     | Inspect normal history/failed APIs for safe timestamps/error codes. Multiple guardians can have different job outcomes. |
| `STUDENT_INACTIVE` / `SESSION_CANCELLED` / `EVENT_EXPIRED` | Suppressed intentionally. Attendance catch-up is limited to seven days.                                                 |

The new global `NotificationProcessorState` model stores only a fixed automation key, random run ID, fixed stage and timestamps. It exposes no cross-tenant job counts. Concurrent run IDs prevent an older invocation from overwriting a newer invocation's heartbeat. Structured `notification_processor` logs contain fixed stages/error codes and a bot-configured boolean; they never print exception messages, config values, recipient IDs or student data. Connection/config/index failures emit a fixed failure stage; a DB failure before heartbeat persistence will leave no new DB heartbeat.

## Render Free and external scheduling

Verified official references: [Render Free](https://render.com/docs/free), [cron jobs](https://render.com/docs/cronjobs), [deploy lifecycle](https://render.com/docs/deploys), [health checks](https://render.com/docs/health-checks).

Free web services sleep after idle traffic and provide neither Free background workers/cron nor Free shell/one-off jobs. Keep the invoker outside the Free web service. This fix does **not** provision or activate a scheduler, change production variables, add an unauthenticated cron URL, merge or deploy. The checked-in Blueprint is older than the actual service settings; runtime inspection above is the evidence for the current Free plan/main branch.

On a trusted external runner, install/build the same approved release once:

```sh
npm ci --include=dev
npm run build
npm prune --omit=dev
npm run telegram:automation -w @softlans/api
```

The command now loads `apps/api/dist/apps/api/src/scripts/telegram-automation.js` using Node, with no `tsx` runtime dependency. For source development use `npm run telegram:automation:dev -w @softlans/api` instead.

Supply required configuration from the runner's secret store: the **same intended demo database**, APP_ORIGIN, JWT_SECRET and existing Telegram bot token/username/webhook secret. Never copy values into source, command arguments, tickets or logs. Grant only the runner's approved stable egress access to Atlas. Schedule the built command every minute; keep dependencies/build outside the recurring invocation. Local cron on a trusted runner is suitable. Hosted GitHub Actions schedules have a minimum five-minute cadence and may be delayed; choose that only if those delays are acceptable. Do not add a paid Render service automatically. A heartbeat proves invocation but does not validate that a mistakenly configured runner is connected to the intended demo database; compare the release and secret-store binding privately.

The run plans both categories independently, then attempts delivery for up to 45 seconds after planning. A global Telegram pacing permit can cause an overlapping runner to exit without delivering; subsequent invocations resume durable jobs. Quiet hours intentionally defer notices, and pending jobs can still become ineligible. Running only the older `telegram:dispatch` command processes the Phase 5.1 staff queue, not guardian `NotificationJob` rows.

## Verify on the live demo after explicit merge/deploy

1. Confirm the approved fix commit is live in Render. Log in as the intended tenant's owner; open `/api/notifications/diagnostics` in that authenticated browser. A 404 before deployment is expected.
2. Enable tenant attendance alerts. Use a synthetic demo student and a guardian account you control, complete verification and `/consent …`, and confirm guardian attendance opt-in. Use a time outside quiet hours (or adjust them through authorized owner settings).
3. On a current non-cancelled lesson, save present, then save absent. Keep correction-only alerts **off** to verify the regression fix. Record the successful attendance response in the browser Network tab, without sharing names/IDs publicly.
4. Open the target diagnostics URL using that session/student's IDs. Before planning, expect `eventRecorded=true` and `WAITING_FOR_PLANNER`. If another reason is returned, resolve that prerequisite instead of blaming Telegram.
5. Verify the external runner configuration, then allow its scheduled invocation. Expect new heartbeat timestamps and either pending/in-progress job status or `DELIVERED`. Use normal Xabarlar tarixi/failed endpoints for delivery timestamp and safe error codes.
6. Confirm the controlled guardian account received the generic message. Re-save the unchanged absent status and run another scheduled cycle: there must be no new attendance notification.
7. Withdraw consent via `/stop` and make another attendance change. Verify no delivery; do not override the guardian opt-out. Inspect failures without blind retries of `UNKNOWN_OUTCOME`.

If no external runner exists, it **still needs configuration**. If one exists, verify its release, compiled command, secret-store database binding, schedule frequency, exit status and heartbeat rather than provisioning a second runner. No live sends or scheduler configuration are performed by this investigation.

## Validation of this fix

- Full `npm test`: **293 API tests** across 18 files and **55 web tests** across 12 files passed, including attendance, Telegram and daily-report regressions.
- Focused notifications suite: **27 passed**, including seven new tests for the real attendance-to-delivery API flow, consent/eligibility diagnostics, diagnostic RBAC/IDOR/privacy, heartbeat visibility, planner-failure isolation, missing-config/completion reporting and edited-status alert policy.
- `npm run typecheck`, `npm run build`, `git diff --check`: passed.
- `npm audit --json`: zero vulnerabilities at every severity.
- Isolated production-only install (`npm ci --omit=dev --ignore-scripts`) had no `tsx`; the built automation command loaded successfully and exited with only a fixed configuration failure code when no credentials were supplied. No external database or Telegram send was involved.
- An initial privacy assertion falsely matched the word “Guardian” inside a diagnostic **field name**; it was corrected to test the quoted fixture value, then the focused and full suites passed. No outstanding automated test failures.
- Actual Render settings/deploy/logs were inspected read-only in the user-confirmed workspace. No production environment variables, confidential database rows or bot credentials were retrieved. No merge, deploy, scheduler provisioning or real Telegram send was performed.
