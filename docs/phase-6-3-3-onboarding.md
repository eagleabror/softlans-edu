# Phase 6.3.3 — Customer onboarding

## Inspection and implementation plan

Registration (`app.ts`) creates Tenant, owner, subscription, trial grant and audit in one MongoDB transaction. Authentication resolves the live user and tenant from an HttpOnly JWT cookie; `authenticate` also applies subscription entitlement. Tenant has only a name, no center update endpoint. Teacher creation is POST /team, teachers are listed by GET /groups/teachers. GroupForm, StudentForm, StudentImport and TelegramSettings already implement validation and business writes. Reuse these components and their APIs; never copy CRM creation logic.

1. Embed optional bounded onboarding metadata in Tenant (one state per tenant), initialized only in registration's transaction. Legacy documents remain untouched.
2. Add owner-only read/progress and center update APIs, strict allowlists and optimistic concurrency.
3. Assemble a responsive Uzbek wizard using existing forms and design classes; add owner-only persistent dashboard checklist.
4. Test registration atomicity, concurrency, permissions, expiry, quotas and UI recovery; run all requested checks.

## Feature and journey

New owners go from registration to `/onboarding`. Six steps cover center details, teachers, groups, students/import, optional personal Telegram linking and a live completion summary. Owners can navigate backwards, save the current step, postpone individual tasks or skip the wizard entirely. Existing GroupForm/StudentForm support an optional success callback; their ordinary CRM navigation remains unchanged. The team dialog supports a teacher-only mode. Telegram uses its existing explicit notification opt-in.

The dashboard shows a nonblocking checklist only to owners with an initialized, unfinished, undismissed state. Each unfinished task links to its wizard step. Completion or explicit dismissal hides the checklist across sessions. A fresh login can resume through the checklist; CRM usage is never gated by onboarding.

## API

All endpoints require live authenticated `business_owner` credentials, same-origin JSON writes and existing rate limiting.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/onboarding` | State (or null for legacy tenants), permitted center fields, live active resource counts, personal Telegram connection, subscription snapshot |
| `PATCH /api/onboarding/center` | `{name, phone?, address?}`; validates and saves permitted fields; records center configuration atomically |
| `PATCH /api/onboarding/progress` | `{revision, action, currentStep?}`; action is save/skip/complete/dismiss; stale revisions return 409 |

Reuse: `POST /api/team`, `GET /api/groups/teachers`, `POST /api/groups`, `POST /api/students`, `/api/student-imports`, `/api/integrations/telegram`. Import opens the existing CRM flow; return to the wizard through the dashboard checklist.

## Data model and concurrency

`Tenant.onboarding` is an optional embedded, bounded document. Tenant `_id` is the authoritative tenantId (returned in state), so no duplicate onboarding record or extra tenant index is possible. Fields: status (`not_started`, `in_progress`, `completed`, `skipped`), completedSteps, currentStep, startedAt, completedAt, updatedAt, dismissedAt, schemaVersion (1), revision. Dates come from the server. Each progress update compares the client's revision and increments it atomically. A second concurrent request receives 409 and can reload; business writes are never retried automatically. Completion is terminal; replay cannot restart completion time. Completed steps are observed from actual resources, with center confirmation recorded on center save. Live checklist facts are always recomputed and may change when resources are archived.

Subdocument versionKey is disabled: Mongoose transaction rollback otherwise attempts to reset an undeclared `__v` under strict mode. The explicit revision controls onboarding concurrency.

## Security

Tenant authority comes exclusively from the server-resolved JWT principal. Strict request schemas reject tenantId, role, subscription and other mass assignment. Existing owner RBAC, active-tenant checks, session revocation, Origin protection, JSON requirement and rate limits remain in force. No credential fields enter the onboarding response. Teacher responses retain existing safe serialization. Telegram consent and linking are unchanged.

Only the exact `PATCH /api/onboarding/progress` metadata route is exempt from expired-subscription write denial. Center changes and all reused CRM writes remain subject to subscription entitlement. Group/student/import quotas retain their existing transactional enforcement. No onboarding action writes subscription price, trial dates, grants, payments or production secrets. Completion means finishing the optional wizard, not asserting that all optional resources exist; summary and checklist facts stay honest.

## Migration and backward compatibility

No bulk migration or production data change is required. New registration initializes onboarding inside the same Tenant/owner/trial transaction. Failed registration rolls it back. Existing tenants have no onboarding default and get `state: null`; they are not redirected or shown setup tasks. Optional phone/address fields need no backfill and are allowlisted/validated at the API. IDs and subscription migration policy remain unchanged.

## Testing

Install with `npm ci` (an accessible npm cache may be needed in sandbox environments), then run `npm test`, `npm run typecheck`, `npm run build`, `npm audit --audit-level=high`, `npm audit --omit=dev --audit-level=high`, `git diff --check`. API tests run a disposable MongoDB replica set; first run may download MongoDB 7.0.24. No production database is needed.

New API tests cover initialization/rollback, legacy tenants, logout session revocation and resume, tenant isolation, owner/admin/teacher/super-admin boundaries, concurrent revisions, completion/skip/dismiss, missing resources, invalid input and recovery, expired trials, student/group quotas. UI tests cover persisted steps, progress semantics, labeled inputs, missing-teacher recovery, real summary values, save errors and checklist persistence. Existing API/UI tests continue exercising reused forms and CRM validations.

## Known limitations

- Import intentionally opens the existing full import workflow; use the dashboard checklist to return.
- The wizard lists the first 20 active teachers via the existing endpoint, with a link to the full paginated team view.
- Multiple tabs receive an explicit conflict instead of silently merging navigation changes.
- A completed wizard stays completed even if optional resources are later removed. Counts remain live; completion is not a certification of configuration completeness.
- Telegram availability depends on existing bot configuration; no bot or notifications are enabled automatically.
- Vite may report the existing large-chunk warning; bundle splitting is outside this change.

## Manual verification checklist

- [ ] Register a new owner with an active plan; verify a single unchanged 14-day trial.
- [ ] Save center name/optional phone/address; refresh and log out/in; resume saved step.
- [ ] Add a teacher, verify existing teacher list and absence of credentials in responses.
- [ ] Create a group with a real teacher; test no-teacher state and plan limit errors.
- [ ] Add a student and open Excel/CSV import; verify validation and quotas.
- [ ] Link Telegram with explicit consent, or postpone without enabling notifications.
- [ ] Review live summary and finish; verify dashboard and checklist disappearance.
- [ ] Skip midway; verify unfinished links and persistent checklist dismissal.
- [ ] Verify legacy owner, admin, teacher and Super Admin access remains unchanged.
- [ ] Expire the trial in a disposable environment: metadata works, business writes fail.
- [ ] Check keyboard navigation, visible focus, reduced motion and narrow layouts.

## Executed validation (2026-11-05)

- `npm test`: passed, API 397 tests / 26 files and web 99 tests / 18 files (496 total). Initial failures exposed strict-subdocument rollback and a test logout request without JSON; both corrected. Onboarding API tests were rerun after the final revision precondition change: 8/8 passed.
- `npm run typecheck`: passed.
- `npm run build`: passed; Vite reports a >500 kB chunk warning.
- `npm audit --audit-level=high`: passed, 0 vulnerabilities.
- `npm audit --omit=dev --audit-level=high`: passed, 0 vulnerabilities.
- `git diff --check`: passed.
- Chromium with the actual built app/API and a disposable MongoDB replica set: registration → center save → teacher creation → postpone group/students → Telegram → completion → dashboard passed; no page errors. No horizontal page overflow at 320, 390, 700, 768, 1024, 1440 px.
- axe WCAG A/AA checks scoped to the center wizard passed after correcting muted text contrast. Keyboard focus reaches the first field; reduced-motion mode exercised. This is a scoped automated check, not whole-app accessibility certification. The separate axe run used Playwright's test-only CSP bypass to inject the checker; the earlier functional browser run kept the application's normal CSP. No application security headers were weakened.
- Screenshots use only disposable local registration data: [mobile](screenshots/onboarding-390.png), [desktop](screenshots/onboarding-1440.png).
