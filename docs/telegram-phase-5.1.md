# Phase 5.1 — Telegram integration

One central bot serves all centers through the existing Express server and Atlas replica set. No deployment, secret changes, or webhook registration happen during build/tests. No debt, parent, attendance, report or billing automation is included.

## Features and API

CRM → **Sozlamalar · Telegram** (`/settings/telegram`) supports business owners, admins and teachers for their own account. Platform admins have no tenant integration. All CRM endpoints retain JWT authentication and origin-based CSRF checks. User/tenant identifiers are derived from the authenticated principal, never accepted from the browser.

| Method | Endpoint | Behavior |
| --- | --- | --- |
| GET | `/api/integrations/telegram` | Availability, own connection status and preferences; no Telegram IDs or tokens |
| POST | `/api/integrations/telegram/link` | Empty JSON; creates/rotates a 10-minute link; connected accounts return 409 |
| PATCH | `/api/integrations/telegram/preferences` | `{ "enabled": true/false }`; own connected account only |
| POST | `/api/integrations/telegram/disconnect` | Empty JSON; revokes links, removes Telegram IDs and disables notifications |
| POST | `/api/integrations/telegram/webhook` | Telegram-only secret authentication, independently of browser sessions |

Responses use `Cache-Control: no-store`. Deep links stay in React state, never local storage, query parameters of CRM pages, or logs. Treat them as credentials: anyone holding an unexpired link can bind their own Telegram identity. Do not share them. A newly generated link invalidates the previous link.

## Security and lifecycle

- Tokens contain 256 bits of random entropy; only SHA-256 hashes are stored. Expiry is checked in MongoDB queries, independently of TTL cleanup. Consuming the token, linking and inserting the webhook receipt happen in a transaction. Concurrent consume attempts cannot both succeed.
- Unique indexes enforce one integration per tenant/user and one active account globally per Telegram user. To switch CRM accounts, explicitly disconnect the old account in CRM first. Administrators cannot link/disconnect somebody else's account through these endpoints.
- Private chats only; sender must match chat ID, must not be a bot, and message dates must be within 10 minutes. Unknown update fields are ignored. Known fields are validated and request bodies are capped at 16 KB.
- Webhook secret comparison uses fixed-size hashes and `timingSafeEqual`. No frontend Telegram identity is trusted. Terminate HTTPS at Render; use the public HTTPS webhook URL exclusively.
- MongoDB receipts deduplicate updates for seven days. Stale-message checks prevent old command replay after receipt retention. Updates are acknowledged only after the transaction commits. No financial/student data appears in command replies.
- Store only Telegram user/chat IDs, connection dates and preferences; no names, usernames, phone numbers or inbound message text. Disconnect erases IDs and hashes. Expired pending hashes are cleared by the delivery runner or replaced/revoked by CRM actions.
- Command replies use Telegram's webhook-response `sendMessage` facility. They are best effort, contain generic Uzbek text only, and are separate from the persistent notification outbox. Duplicate updates do not repeat replies.
- MongoDB indexes are installed by the existing startup `ensureIndexes` flow. Delivery records have 30-day TTL retention; idempotency keys are unique within a tenant during that retention window. Receipt TTL cleanup can lag without changing authorization behavior.

## Notification infrastructure and operational limits

`enqueueTelegram({ tenantId, userId, idempotencyKey, text })` is an internal single-recipient service. It has no public HTTP producer, bulk endpoint, or automatic notification producer in this phase. Keys must represent a stable business event, not a fresh value on each retry. Reusing a key returns the original record and does not replace its recipient or payload. Future student/parent recipients require separate authorization/consent policies; `recipientKind` currently permits only `user`.

`dispatchTelegram(config)` claims at most one due job using a MongoDB lease. Check linked status, revision, opt-out, active user and tenant again immediately before send. Disconnect, stop and preference changes invalidate previously queued jobs; re-enabling does not resurrect them. A notification already in flight at Telegram cannot be recalled by disconnect.

The maintained grammY API client uses a 10-second timeout. Delivery states are `pending`, `sending`, `sent`, `failed`, `cancelled`. Attempts, due times and safe error codes are persisted, never raw API errors or messages in logs. Terminal records erase message text. HTTP 429 observes `retry_after` (bounded to 24 hours); explicit 5xx API errors use bounded exponential backoff. Maximum five attempts. 403 disables notifications. Ambiguous transport errors and abandoned leases become `failed/UNKNOWN_OUTCOME`, since Telegram sendMessage has no remote idempotency guarantee. Review these manually; automatic resend could duplicate a delivered message. There is no automatic retry of unknown outcomes.

Global MongoDB pacing permits approximately one delivery per 1.1 seconds, with a 60-second lease while a send is active. This intentionally favors low-volume safe delivery. No in-memory state, polling bot worker, setInterval or reliable process lifetime is assumed.

To process one due notification manually (with backend environment loaded):

```sh
npm run telegram:dispatch -w @softlans/api
```

A future separately provisioned scheduler can invoke this bounded task repeatedly. **This phase provisions no scheduler.** Pending retries remain persisted until another invocation. The command is not called by builds, server startup, tests or webhook handlers.

Render Free web services can sleep after inactivity, have cold starts and restart at any time; local filesystem/timers are not durable. Telegram may retry webhook requests during cold starts. Atlas stores receipt/link/delivery state across restarts. Free instances cannot guarantee prompt delivery; an always-available paid service and an external task trigger are needed for delivery timing guarantees. Do not add keep-alive pings or rely on in-process scheduled work.

## BotFather setup (manual)

1. Open Telegram's verified **@BotFather** account (`https://t.me/BotFather`). Send `/newbot`.
2. Enter display name `SoftLans Edu`, then an available username ending in `bot`, for example `SoftLansEduBot`. This is the one central SaaS bot, not one bot per center.
3. Save the resulting token in your secret manager. Never commit it, paste it in a PR, or place it in a frontend environment variable.
4. Send `/setcommands`, select the bot, then send exactly:

```text
start - Hisobni xavfsiz ulash
help - Buyruqlar bo‘yicha yordam
status - Ulanish holati
stop - Bildirishnomalarni o‘chirish
```

5. Send `/setjoingroups`, select the bot, choose `Disable`. Keep privacy enabled with `/setprivacy` → bot → `Enable`.
6. Optionally set `/setdescription` to `SoftLans Edu hisobingizni CRM sozlamalari orqali xavfsiz ulang.`

## Automatic Render HTTPS webhook registration

The server uses only the existing backend `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_BOT_USERNAME` and `TELEGRAM_WEBHOOK_SECRET` environment variables.
Missing or malformed Telegram values disable the integration without stopping CRM.
Never prefix these variables with `VITE_`; no Render variable changes are required.

After an authorized deployment, production startup registers
`https://softlans-edu-demo.onrender.com/api/integrations/telegram/webhook` only
when `APP_ORIGIN` is `https://softlans-edu-demo.onrender.com`. Local development,
tests and other origins skip registration to avoid redirecting the shared bot.
Registration runs after database/index initialization and HTTP listening, never
from builds, app creation, requests or the delivery task. No deployment is
performed by this change.

Startup calls `getWebhookInfo`, then `setWebhook` when needed with the existing
secret as `secret_token`, `allowed_updates: ['message']`, `max_connections: 1`
and `drop_pending_updates: false`. Existing pending updates are retained.
Telegram calls use the maintained grammY client with a 10-second timeout per call.
The CRM continues serving while this best-effort task runs; API or persistence
failures do not fail startup. Another check occurs at the next application startup.

Telegram does not return the configured secret. A MongoDB record stores only a
keyed settings fingerprint after successful registration. The first startup,
missing record or credential rotation reapplies the secret, even if the URL
already matches. Subsequent startups skip `setWebhook` when the fingerprint and
visible URL, certificate, connection and update settings match. An external
secret-only change cannot be detected by Telegram's API; after such a manual
change, restore the intended configuration by rotating the backend webhook
secret through the normal operator process and restarting the app.

Logs contain only the event `telegram_webhook_registration` and status
`skipped`, `unchanged`, `registered` or `failed`; never API errors, responses,
token-bearing URLs or credentials. Existing secret-header authentication, CRM
JWT/origin checks, linking transactions and delivery behavior remain in place.

## Manual acceptance checklist

- [ ] Owner, admin and teacher each open Sozlamalar → Telegram; tenantless platform admin has no integration page.
- [ ] Connect opens the intended bot; Start shows Uzbek success; refresh CRM shows Ulangan.
- [ ] Confirm link expires after 10 minutes, is rejected on replay, and an old link stops working after rotation/disconnect.
- [ ] A second unrelated CRM account cannot reuse the connected Telegram identity; it can link only after explicit old-account disconnect.
- [ ] `/help`, `/status`, `/stop` return Uzbek generic text without CRM personal/financial data.
- [ ] Stop clears preferences in CRM; re-enable through CRM; disconnect confirmation supports cancel, Escape and keyboard focus return.
- [ ] Refresh, loading, failure/retry, unavailable-config and success states work. Inspect at 320, 390, 700, 768, 1024 and 1440px and 200% zoom; no page overflow.
- [ ] Invalid/missing webhook secret returns 401; duplicate updates have one effect; groups and old messages cannot link.
- [ ] With synthetic internal enqueue only, run dispatch; verify sent/cancelled/failed states, idempotency, opt-out and bounded 429/5xx retry timestamps. No automatic reminders appear.
- [ ] Restart Render and invoke again: states survive; pending jobs resume and abandoned sends fail for manual review.
- [ ] Existing students, payments, attendance, analytics and payroll remain usable.

Automated validation and changed files are recorded in the PR. Live BotFather, Render and visual browser acceptance require the operator's configured bot and deployed service; tests never contact the real Telegram API.

## Implementation verification report

Base inspected: latest main `b638433b73fd1047b8d99e36aa3eda5149edcb87` (includes Phase 4.2 and merged payroll/sidebar fixes). Branch: `feat/phase-5-telegram-integration`.

- `npm ci`: passed.
- `npm test`: passed, API **218 tests / 15 files**, web **47 tests / 10 files** (265 total).
- `npm run typecheck`: passed across workspaces.
- `npm run build`: passed API TypeScript compilation and Vite production build.
- `npm audit`: **0 vulnerabilities**, including development dependencies.
- `npm audit --omit=dev`: **0 vulnerabilities**.
- `git diff --check`: passed.
- Telegram tests cover entropy/hash, expiration/rotation/replay, successful link, tenant isolation, CSRF/auth, bad secrets/payloads, concurrent duplicate delivery, disconnect/revocation, identity reuse policy, opt-out, queue idempotency, cancellation, rate-limit retry exhaustion, API 403/500, unknown transport outcomes, stale leases, stale/group/forged-identity updates, generic commands and missing configuration. UI tests cover deep-link generation/error recovery and opt-out/disconnect confirmation cancellation.
- Security checks use synthetic accounts and mocked Telegram sends. No real Telegram API calls, Render changes or deployments occurred. Browser screenshots, responsive visual review, live TLS/bot configuration, and live restart acceptance remain operator checks.

Changed files:

- `apps/api/src/telegram.ts`: authenticated CRM routes and independently authenticated webhook/commands/link transactions.
- `apps/api/src/telegram-models.ts`: integration, receipt, outbox and global pacing schemas/indexes.
- `apps/api/src/telegram-delivery.ts`: internal enqueue, claims, retries and status tracking.
- `apps/api/src/scripts/telegram-dispatch.ts`: bounded manual task runner.
- `apps/api/src/app.ts`, `models.ts`, `config.ts`: existing server, startup indexes and optional backend configuration integration.
- `apps/api/tests/telegram.test.ts`: security/integration/delivery regression coverage.
- `apps/api/package.json`, root `package-lock.json`: grammY and dispatch/test scripts.
- `apps/api/.env.example`: three backend-only Telegram variables.
- `apps/web/src/Telegram.tsx`, `Telegram.test.tsx`: Uzbek settings UI and interaction tests.
- `apps/web/src/App.tsx`, `styles.css`: tenant navigation/route and scoped layout styles.
- `README.md`, `docs/telegram-phase-5.1.md`: setup, operations, verification and manual checklist.
