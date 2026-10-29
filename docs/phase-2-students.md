# Phase 2.1 — Student management

Extends the existing Phase 1 Express/Mongoose API, React/TypeScript/Tailwind frontend, shared contracts and cookie session flow. No new runtime dependencies. No groups, attendance, payments, scheduling or permanent deletion.

## API contract

All endpoints require the existing JWT cookie. Only current database roles `business_owner` and `admin` can use them. Teachers and platform administrators get 403, including when they supply a tenant header. Missing/invalid sessions get 401. Every Student read, count and update uses `tenantScope(principal(req))`; creation injects the authenticated tenant and creator. Tenant/creator IDs and unknown input keys are rejected.

| Method | Path                       | Response                                  |
| ------ | -------------------------- | ----------------------------------------- |
| POST   | `/api/students`            | 201 `{ student }`                         |
| GET    | `/api/students`            | 200 `{ students, total, page, pageSize }` |
| GET    | `/api/students/:id`        | 200 `{ student }`                         |
| PATCH  | `/api/students/:id`        | 200 `{ student }`                         |
| PATCH  | `/api/students/:id/status` | 200 `{ student }`                         |

List parameters: `page` (1–10000, default 1), `pageSize` (1–100, default 20), `search` (up to 100 characters), `status` (`active`, `paused`, `archived`) and `sort` (`asc`/`desc`, default `desc`). Sorting uses enrollment date and ID as a stable tie breaker. Search matches literal case-insensitive name tokens across first/last name or normalized phone substrings. Regex metacharacters are escaped.

Create accepts firstName/lastName (required, at most 100 characters each), phone/parentPhone (optional, 7–15 digits and optional leading plus after normalization), parentName (optional, at most 100 characters), birthDate (optional/null), enrollmentDate (optional, defaults to now), status (optional, defaults to active), notes (optional, at most 2000 characters). Dates use real `YYYY-MM-DD` calendar dates between 1900-01-01 and today (UTC). Names use NFC normalization and collapsed whitespace. Notes reject unsafe control characters. General PATCH accepts the same editable fields except status; an empty PATCH is rejected. Optional strings can be cleared with `""`, birthDate with null. Status PATCH accepts only `{ status }`.

Student views expose an explicit field allowlist, including creator and timestamps, without tenantId or Mongoose internals. Invalid/missing/cross-tenant IDs produce the same Uzbek 404. Existing structured error/request ID format, body size limit, no-store headers, origin/JSON validation and rate limiting remain in place. PATCH is added to CORS methods. Request bodies, search queries and phone numbers are never logged.

## Dashboard

Owner/admin `/api/dashboard` responses add `students: { total, active, paused, recent }`. Total includes archives; recent counts all statuses enrolled in the rolling last 30 days, through now. Teachers and super admins receive no student statistics. Existing Phase 1 dashboard fields remain intact.

## Storage and operational notes

Startup creates the Student collection and these compound indexes using the existing `ensureIndexes()` flow:

- `{ tenantId: 1, enrollmentDate: -1, _id: -1 }`
- `{ tenantId: 1, status: 1, enrollmentDate: -1, _id: -1 }`

Tenant and creator are required immutable ObjectId references. Collection is shared across tenants. No migrations of existing documents are needed. The deployment database user needs the same create-collection/index privileges already used during Phase 1 startup. No environment variable changes are required.

Literal substring search scans the tenant subset; it is intended for the initial module, not large-scale indexed full-text search. Pagination uses bounded offsets. Concurrent edits use last-write-wins. Counts are live independent queries, not a transaction snapshot. Browser/device visual checks should be performed during manual acceptance; automated UI tests cover behavior in jsdom.

## Validation and manual acceptance

Run `npm ci`, `npm test`, `npm run typecheck`, `npm run build`, `npm audit --audit-level=high` and `npm audit --omit=dev --audit-level=high`. Dedicated API integration command also includes `tests/students.test.ts`. Tests use temporary MongoDB instances and fictional student/contact data only; they do not connect to Atlas or seed the demo.

After a separately approved merge and manual deployment:

1. Sign in as an owner or admin; open **O‘quvchilar** from the sidebar. Confirm the empty state on a tenant without students.
2. Add a fictional student with optional parent/date/notes fields. Confirm the Uzbek success notice, profile and normalized phone/name values.
3. Edit the student, clear optional fields and save. Try invalid phones and future dates; verify the form/error feedback and focus on invalid fields.
4. Add enough fictional students for two pages. Search by full name/phone, filter statuses and sort enrollment dates. Verify pagination and empty search results.
5. Pause a student; archive another after confirmation. Cancel an archive first. Confirm archived records remain visible under the archive filter and can be reactivated.
6. Return to the dashboard and verify the four student counts against the records. Recent enrollment means the last 30 days; archives still count in the total.
7. Sign in as a teacher and a super admin. Confirm no O‘quvchilar navigation or student statistics. Direct API calls must return 403.
8. Use two separate tenants: copy a student ID from one and request/read/edit/status-change it using the other tenant's session. Expect 404 and unchanged data. Unauthenticated API calls must return 401; originless or foreign-origin writes must return 403.
9. Test keyboard navigation, dialog Escape/cancel/focus behavior, mobile sidebar, narrow-screen forms and table scrolling. Refresh a student profile URL to verify the existing production SPA fallback.

No Render/Atlas variables, deployments, live student records or production seeds are changed by this implementation.

## Implementation verification report

- Phase 1 baseline on main `7e27570`: 106 API tests and 5 frontend tests passed before implementation.
- Final suite: 129 API tests and 10 frontend tests passed (139 total, 28 added; zero failures).
- TypeScript checks, API production compilation, Vite production build and `git diff --check` passed.
- Full dependency audit and production-only audit: zero vulnerabilities; no dependency changes.
- Security coverage: all five endpoint role matrices, unauthenticated access, cross-tenant detail/update/status IDOR, hostile tenant headers/query/body fields, mass assignment, NoSQL/regex injection, invalid IDs/dates/phones/pagination, origin/JSON guards and statistics disclosure. Existing Phase 1 JWT/session revocation and deployment/startup tests also pass.
- UI coverage: list/search/filter/pagination, recoverable errors/empty states, create success, edit field validation/focus, archive confirmation, owner navigation/dashboard values and hidden teacher navigation.
- No live deployment or browser/device visual acceptance was performed. No Render or Atlas settings were changed.

Changed files:

- API: `apps/api/package.json`, `apps/api/src/app.ts`, `apps/api/src/models.ts`, `apps/api/src/student-validation.ts`, `apps/api/src/students.ts`, `apps/api/tests/students.test.ts`.
- Frontend: `apps/web/src/App.tsx`, `apps/web/src/App.test.tsx`, `apps/web/src/Students.tsx`, `apps/web/src/Students.test.tsx`, `apps/web/src/styles.css`.
- Shared contracts: `packages/contracts/src/index.ts`.
- Documentation: `docs/phase-2-students.md`.
