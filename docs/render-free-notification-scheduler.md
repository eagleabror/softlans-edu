# Render Free notification delivery — phone setup

## What is happening

The confirmed live release at the start of this investigation was `69d3cfa` (PR #20). Render runs `softlans-edu-demo` on **Free**, branch `main`, with:

```text
Build: npm ci --include=dev && npm run build && npm prune --omit=dev
Start: npm start -w @softlans/api
```

The start command serves the CRM/API and registers the Telegram webhook. It does **not** invoke the notification planner/processor. There is no Render worker/cron for this repository, and the repository has no scheduled workflow. A job's `nextAttemptAt` passing does not execute anything by itself. Overdue “Sinov” jobs at 0/5 attempts are consistent with that missing invocation; consent changes, quiet hours and eligibility still need to be distinguished using diagnostics. A separately configured external command runner cannot be ruled out from Render service discovery alone.

The exact command that plans guardian/owner notifications and processes the durable `NotificationJob` queue is:

```sh
npm run telegram:automation -w @softlans/api
```

After building, this is equivalent to the following command **from the repository root**:

```sh
node apps/api/dist/apps/api/src/scripts/telegram-automation.js
```

`telegram:automation:dev` uses tsx for local source development. `telegram:dispatch` is the older Phase 5.1 **staff** delivery queue and does not process Phase 5.2 guardian jobs. Do not put the processor in Render's Start Command instead of the HTTP server: the web service must still listen on its port.

## Small follow-up change

This PR adds only an optional, machine-authenticated trigger:

```text
POST https://softlans-edu-demo.onrender.com/api/internal/notifications/run
Authorization: Bearer <separate scheduler secret>
Content-Type: application/json
Body: {}
```

An external HTTP scheduler can now start the **existing** processor inside the existing Render web process. No second Node process, new database, queue rewrite, cron service, background worker or paid resource is needed. An external trigger is still necessary; the endpoint does not create a schedule by itself.

The endpoint is disabled unless `NOTIFICATION_SCHEDULER_SECRET` is configured. It accepts only that dedicated bearer secret, never CRM cookies, the JWT secret, the bot token or the webhook secret. It takes no tenant, recipient, message or job overrides and returns no confidential information. Normal CRM JWT/CSRF/RBAC and Telegram webhook validation remain unchanged. Do not place credentials in URLs or use GET as the trigger.

The gate uses MongoDB atomic admission: one HTTP batch at a time, a minimum 60-second admission interval, and a five-minute lease for crash recovery. Simultaneous requests/restarts/multiple API instances share that gate. Existing per-job leases, eligibility checks, consent revocation, idempotency keys, pacing and retry limits still control all deliveries, including when a CLI runner overlaps. A batch spends up to 45 seconds processing **after** planning; planning time is additional. The HTTP acknowledgement is immediate after admission, so external 30-second timeouts do not require shortening or replacing the worker. HTTP 202 means accepted/skipped, **not delivered**. A web restart can interrupt the batch; durable jobs and later triggers provide recovery. An unusually long planner exceeding the five-minute HTTP lease can overlap a new planner, while existing per-job send leases/idempotency remain the final safeguards.

## 1. Render Dashboard — use your phone

These are manual instructions for the owner after reviewing the PR. This investigation does not merge, deploy, modify variables or activate a scheduler.

1. Approve/merge the PR only when ready. This service currently auto-deploys `main`; wait for the fix deployment to become **Live**. If no automatic deploy starts, open the service → **Manual Deploy → Deploy latest commit**. Do not test the new URL against an older deployment; it will return 404.
2. Open [the existing demo service](https://dashboard.render.com/web/srv-dbhr2u88v5cc7396t4ng). On a narrow phone screen, open the menu to find the service sections.
3. Open **Environment → Environment Variables → + Add Environment Variable**.
4. Set the key to **`NOTIFICATION_SCHEDULER_SECRET`**.
5. In a trusted password manager on your phone, generate a **new random 64-character password using letters and digits** and paste it as the value. Save it privately for the next section. The application accepts 43–128 characters from letters, digits, `_`, `-`, `+`, `/`, `=`. Do not use a name, ordinary password, bot token, webhook secret or JWT secret. Do not paste the value into chat or screenshots.
6. Choose **Save and deploy** if the fix's build is already live. Choose **Save, rebuild, and deploy** if you also need to build updated code. **Save only** does not activate the variable until a later deploy. Wait for **Live** before testing.
7. Leave **Start Command**, **Build Command**, plan and service type unchanged. Do **not** choose New → Cron Job or Background Worker: Render does not offer those as Free instances.
8. In the same browser where you are logged into the CRM as the owner, open:

   `https://softlans-edu-demo.onrender.com/api/notifications/diagnostics`

   After deploying the fix and setting the secret, `schedulerEndpointConfigured` should be `true`. `telegramConfigured` should be `true` as well; this checks configuration presence/syntax, not Telegram connectivity. Before the first observed run, processor state may be `never_seen` or `stale`.

### Required secrets — where they belong

| Setting                         | Render web service                                | External HTTP scheduler                      |
| ------------------------------- | ------------------------------------------------- | -------------------------------------------- |
| `NOTIFICATION_SCHEDULER_SECRET` | New dedicated random secret                       | The same value, only in Authorization header |
| `TELEGRAM_BOT_TOKEN`            | Existing server-side value                        | **Do not copy**                              |
| `TELEGRAM_BOT_USERNAME`         | Existing server-side value                        | Not needed                                   |
| `TELEGRAM_WEBHOOK_SECRET`       | Existing server-side value                        | **Do not copy**                              |
| `MONGODB_URI`                   | Existing intended demo database binding           | **Do not copy**                              |
| `JWT_SECRET`                    | Existing server-side value                        | **Do not copy**                              |
| `APP_ORIGIN`                    | Existing `https://softlans-edu-demo.onrender.com` | Not needed                                   |

No new Render API key, cron-job.org API key or Atlas network allowlist change is needed for this HTTP option. The scheduler contacts the API; only the API contacts Atlas and Telegram. The new secret grants the ability to trigger fixed due-job processing across tenants, so restrict access to the Render environment and scheduler account. All tenant/recipient consent checks still apply inside the processor.

## 2. Free external HTTP scheduler — phone setup

One compatible option is [cron-job.org](https://console.cron-job.org/). Its documented free scheduling supports every minute, POST and custom headers. Create/manage the job yourself; no account or schedule is created by this PR.

1. Sign in to the cron-job.org Console, open **Cronjobs**, then **Create cronjob**.
2. Title: **SoftLans Telegram notifications**.
3. URL — copy exactly:

   `https://softlans-edu-demo.onrender.com/api/internal/notifications/run`

4. Execution schedule: **Every 1 minute** (or select every minute/hour/day). Timezone can be **Asia/Tashkent**; a once-per-minute trigger is unaffected by timezone.
5. Open the advanced request settings. Choose **POST** as the request method. Do not use GET or HEAD. Leave Basic Authentication/cookies off.
6. Add these custom request headers:

   - Name: `Authorization`; value: `Bearer ` followed immediately by the **new scheduler secret** from Render. There is one space after Bearer; no quotes or angle brackets.
   - Name: `Content-Type`; value: `application/json`.

7. Request body: **`{}`**. Do not add student IDs, Telegram IDs, tenant IDs, bot tokens or custom messages. Keep HTTPS/TLS validation enabled.
8. Save/enable the job. Use its test/run-now action once, then inspect its execution history.
9. A successful request returns **202** and either `{"status":"accepted"}` or `{"status":"already_running_or_rate_limited"}`. The second response is normal if a prior batch is active or less than 60 seconds have passed. Clock/network jitter can cause a minute's trigger to be skipped; the next invocation resumes durable pending work.
10. Open Render → demo service → **Logs** and filter for `notification_scheduler` or `notification_processor`.

Render Free cold starts can take about a minute, while cron-job.org documents a 30-second request timeout. The first request after sleep may fail while waking Render; let the next scheduled request run. Persistent failures are not normal. Minute-by-minute HTTP calls usually keep the web service awake and consume its existing shared Free instance-hour quota. Free sleeping/restarts/usage limits still apply; this is a demo setup rather than an always-on production delivery guarantee. No paid Render resource is enabled.

### Expected safe logs

After an accepted invocation, expect fixed metadata such as:

```json
{"event":"notification_scheduler","status":"accepted"}
{"event":"notification_processor","stage":"started","telegramConfigured":true}
{"event":"notification_processor","stage":"completed"}
{"event":"notification_scheduler","status":"completed"}
```

There are no message bodies, student/guardian names, Telegram IDs or secret values. A completed batch may still leave deferred, ineligible or rate-limited jobs; inspect history and diagnostics rather than interpreting the batch log as proof of individual delivery. Errors use fixed codes such as `PLANNING_FAILED`, `PROCESSING_FAILED`, `BATCH_FAILED` or `LEASE_RELEASE_FAILED`.

| HTTP result                      | Meaning / next step                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 202 accepted                     | Batch admitted; check heartbeat/history next.                                                                                                     |
| 202 already running/rate limited | Another batch or the 60-second admission interval; wait for the next invocation. A crashed run's HTTP gate can take up to five minutes to expire. |
| 401                              | Missing/wrong bearer value. Compare the two secret-store entries privately; no bot/webhook/JWT secret is accepted.                                |
| 404                              | Wrong host/path/method or the new PR is not deployed. A browser GET intentionally does not execute the job.                                       |
| 503 SCHEDULER_DISABLED           | New secret absent from the active Render deployment. Check Save/deploy completion.                                                                |
| 503 TELEGRAM_UNAVAILABLE         | Existing bot configuration missing/invalid; fix it privately in Render.                                                                           |
| 400 / 413                        | Unexpected query/body or body too large. Use no query and `{}` only.                                                                              |
| 429                              | Too many requests; stop repeated manual tests and wait.                                                                                           |
| Timeout / 502 / 500              | Check cold-start/deploy/DB status and fixed safe logs; never share raw credentials.                                                               |

To disable the HTTP trigger, disable the external job, remove `NOTIFICATION_SCHEDULER_SECRET` from Render and deploy that environment change. Do not set it to an empty string. A batch already accepted can finish; recipient `/stop` and normal eligibility checks remain the notification opt-out controls. To rotate it, generate a new independent value and update Render plus the scheduler header; do not rotate the bot or webhook credentials just to change this trigger.

## 3. Verify “Sinov” and attendance

1. After the first scheduler run, refresh the owner diagnostics URL. Expect new heartbeat/completion timestamps and a recent processor state. No state change means the request did not reach/execute this deployment's processor.
2. Create **one fresh “Sinov”** for a verified, explicitly consenting guardian you control, outside quiet hours. Wait one or two scheduler cycles, refresh Xabarlar tarixi and confirm the Telegram message. Successful delivery increments attempts to at least 1 and records a delivery timestamp.
3. The two old guardian “Sinov” jobs may now become **cancelled with 0 attempts** if they are over one hour old or consent/link revision changed. This is intentional eligibility suppression, not a reason to clear job keys, force retries or bypass consent. Owner daily-report tests have their existing separate 24-hour lifetime.
4. Enable tenant attendance alerts and the guardian's attendance preference. On a current non-cancelled lesson, mark a controlled demo student absent and save. An existing present mark changed to absent is supported by merged PR #20 even when correction-only alerts are off.
5. Attendance saving creates a committed **`AttendanceEvent`**, not a `NotificationJob` directly. The triggered planner then creates a unique job per eligible guardian/event. No planner invocation means the event can exist without any attendance job, while manually created “Sinov” jobs are already pending.
6. If no attendance job appears, use the owner-only target diagnostics URL:

   `/api/notifications/diagnostics?studentId=<student-id>&sessionId=<session-id>`

   On your phone, the lesson page URL ends in `/attendance/sessions/<session-id>`; the student's detail page ends in `/students/<student-id>` (the attendance student page also ends in its student ID). Copy those IDs privately into the diagnostic URL. Do not post live URLs/IDs publicly.

   - `NO_ATTENDANCE_EVENT`: no committed changed status was recorded for that pair; an unchanged re-save creates none.
   - `WAITING_FOR_PLANNER`: eligible event exists, but there is no job yet.
   - `TENANT_ATTENDANCE_DISABLED`, `NO_VERIFIED_GUARDIAN`, `NO_GUARDIAN_CONSENT`, `RECIPIENT_ATTENDANCE_DISABLED`: resolve that prerequisite; staff cannot grant consent for a guardian.
   - `QUIET_HOURS`, `DELIVERY_PENDING`, `DELIVERED`, `DELIVERY_FAILED`: follow that stage in history. Blocked/invalid chats and Telegram 429 appear as safe delivery codes; an expired sending lease/ambiguous network outcome remains non-retriable `UNKNOWN_OUTCOME`.

7. Re-save the unchanged absence. The next scheduler cycle must not create/send a duplicate. `/stop` must suppress later sends.

Existing limits remain: seven-day attendance catch-up, latest-event correction/cancellation checks, quiet hours in Asia/Tashkent, bounded retries, recipient revision checks and best-effort duplicate reconciliation. No particular production student's consent/outbox rows were retrieved in this investigation; use the authenticated diagnostics to establish their exact stage without exposing guardian information.

Official references checked for these instructions: [Render environment settings](https://render.com/docs/configure-environment-variables), [Render Free limits](https://render.com/docs/free), [cron-job.org FAQ](https://cron-job.org/en/faq/) and [request methods/custom-header support](https://docs.cron-job.org/rest-api.html).

## Validation and scope

- Full `npm test`: **304 API tests** across 19 files and **55 web tests** across 12 files passed.
- Ten new scheduler integration tests cover disabled/default access, authentication isolation, query/body rejection, prompt acknowledgement, concurrent instances, persistent pacing/crash recovery, safe error handling, unchanged CRM/CSRF/webhook protections, secret validation and an actual durable pending job delivered through the existing processor with mocked Telegram transport.
- Added a regression proving old guardian test jobs can be cancelled with zero attempts rather than forcing stale delivery. Existing real attendance API → committed outbox → planner → consenting guardian → delivery tests remain passing.
- `npm run typecheck`, `npm run build`, `git diff --check`: passed. `npm audit --json`: zero vulnerabilities.
- No new dependencies, frontend changes or notification-system rewrite. New model: one `NotificationSchedulerLease` admission row with primary-key uniqueness; existing job models/leases and processor are reused.
- Live Render metadata was inspected read-only in the previously user-confirmed workspace. No live guardian rows, secrets or Telegram messages were retrieved/sent. No merge, deployment, environment mutation, external schedule activation or paid service was performed.
