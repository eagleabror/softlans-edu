# Phase 2.2 — Groups and teacher assignment

This extends Phase 2.1 in the existing API, React application and design system. It does not add scheduling, attendance, payroll or payment processing. `monthlyFee` is group metadata only.

## API

All paths below are under `/api`. Cookie authentication, origin/CSRF checks, request size limits, safe errors and the existing API rate limiter apply. Client tenant identifiers and unknown input fields are rejected; the server derives scope from the authenticated user.

| Method | Path | Behavior |
| --- | --- | --- |
| POST | `/groups` | Create group with an active same-tenant teacher |
| GET | `/groups` | Paginated list; `page`, `pageSize`, `search`, `status`, `teacherId` filters |
| GET | `/groups/:id` | Group details and assigned teacher name |
| PATCH | `/groups/:id` | Partial update, including status, teacher and capacity |
| POST | `/groups/:id/archive` | Archive without deleting; JSON body `{}` |
| PATCH | `/groups/:id/teacher` | Assign/change teacher; `{ "teacherId": "…" }` |
| GET | `/groups/teachers` | Minimal active teacher choices; `search`, `page` |
| POST | `/groups/:id/members` | Enroll existing student; `{ "studentId": "…" }` |
| POST | `/groups/:id/members/:studentId/remove` | Mark active membership removed; JSON body `{}` |
| GET | `/groups/:id/members` | Paginated members; `page`, `pageSize`, `status=active\|removed` |
| GET | `/dashboard` | Adds `groups: { total, active, activeMemberships }` for owners/admins; preserves students |

Pagination defaults to 20 records and caps at 100 (teacher choices use 20). Group search matches escaped literal text in name/course. Teacher callers always receive only their own assignments, regardless of a supplied teacher filter. Invalid or foreign resources return safe errors without revealing another tenant's records.

Business owners and admins manage groups and membership. Teachers can list/read assigned groups and active members only. Student responses contain only ID, first name, last name and status; contact information, parents, dates of birth and notes are excluded. Super admins have no group access and receive no center group statistics.

## Data and concurrency

- `Group` has immutable tenant scope, strict Mongoose validation, timestamps, integer capacity (1–10,000), nonnegative safe-integer UZS fee, status and compound tenant indexes.
- `Membership` has immutable tenant/group/student references and enrollment timestamp, status, timestamps, tenant indexes and a partial unique index on `(tenantId, groupId, studentId)` for active records.
- Removal changes status; reenrollment inserts a new record. A student can belong to multiple groups. Paused students and paused groups accept enrollments; archived students/groups do not.
- Enrollment uses a replica-set transaction. A conditional group counter increment reserves a seat atomically, and membership insertion commits with that increment. Duplicate insertion/other errors roll back the reservation. Capacity changes and archival write the same group document and serialize with enrollment. Removal changes the membership and decrements the counter in one transaction.
- A hidden student `membershipRevision` increment serializes enrollment with concurrent student archival. Existing students need no backfill; `$inc` initializes the field.
- Archive preserves active memberships and history. Consequently active membership statistics include active membership records in archived/paused groups until explicitly removed. Student archival does not automatically remove existing memberships.
- Startup creates the new collections and indexes through the existing `ensureIndexes` mechanism. No production database or credentials were changed during implementation. Do not bypass the application transaction path for membership writes, since the counter must remain consistent.

## UI and acceptance

1. As a Business Owner, open **Guruhlar**, create a group, find a teacher using the searchable paginated selector, and enter capacity, UZS fee and start date. Verify detail and list values.
2. Edit the group and change teacher. As an Admin, repeat editing and assignment. Confirm a capacity below current membership count is rejected.
3. Search for existing active or paused students, enroll them, verify the capacity indicator and members table, and try a duplicate enrollment and a full group. Errors should leave counts unchanged.
4. Remove a student, open **Chiqarilganlar tarixi**, and reenroll. Verify the removed record remains. Add the same student to another group.
5. Archive the group and confirm no new enrollment is available. Existing membership history remains visible. Updating a description must preserve archived status.
6. As the assigned Teacher, verify read-only group/member views. Try another group's URL and confirm access is denied. Verify no contact/parent/private student fields appear. After reassignment, the old teacher must lose access.
7. As an owner in another center, try known group/student/teacher IDs from the first center. Confirm no access or assignment. As Super Admin, verify no group module or group API access.
8. Verify dashboard total groups, active groups and active memberships alongside unchanged student statistics. Check empty, error/retry and loading states, pagination, search, and narrow mobile layouts.

## Validation

The group integration suite runs against an ephemeral MongoDB replica set and covers CRUD/archival, assignment, history, multiple groups, duplicate memberships, capacity, concurrent enrollment/removal/edits/archival, invalid input/references, tenant isolation, RBAC, student projection and dashboard counts. React tests cover list/search, errors/retry/empty state, teacher read-only details and group creation. Existing Phase 1, deployment and Phase 2.1 tests remain in the full run.

Verified results:

- `npm test`: **152 passed** (138 API tests across 8 files; 14 React tests across 3 files).
- `npm run typecheck`: passed for both workspaces.
- `npm run build`: API TypeScript compilation and React production bundle passed.
- `npm audit`: **0 vulnerabilities** across all severities.
- `git diff --check`: passed.

Changed files: `apps/api/src/{app,models,group-models,group-validation,groups}.ts`, `apps/api/tests/groups.test.ts`, `apps/web/src/{App,Groups,Groups.test}.tsx`, `apps/web/src/styles.css`, `packages/contracts/src/index.ts`, and this report.

Limits: no live Atlas/Render changes or deployment verification; manual browser acceptance remains for reviewers. Search uses bounded escaped regular expressions, following the existing student module, rather than Atlas Search. No lesson scheduling, attendance, payroll or payment features are included.
