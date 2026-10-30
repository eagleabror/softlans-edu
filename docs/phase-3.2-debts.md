# Phase 3.2 — Debt management and overdue payments

Debt is a read-only projection of existing monthly charges and immutable payments, excluding payments with a same-tenant reversal. Reports deliberately reconcile from the ledger instead of relying on the charge's paidAmount cache. There is no debt collection, independent balance, financial write endpoint or membership join. Each charge contributes once. Cancelled and zero-balance charges are excluded; remaining balances are clamped at zero. Discounts are respected through finalAmount. Past balances reflect current adjustments and reversals, consistent with Phase 3.1.

## Time and accounting

A charge remains upcoming throughout its due calendar date in Asia/Tashkent. At the next local midnight it is one day overdue. MongoDB `$dateDiff` with an explicit timezone measures calendar day boundaries, rather than elapsed 24-hour periods. Buckets are 0 (upcoming), 1–7, 8–30 and 31+. Each operation captures one server timestamp. Pure helpers and injected `now` in the reporting service make boundaries deterministic in tests. The client cannot override the reporting time.

Outstanding includes upcoming and overdue debt across all billing months by default. It is different from the existing current-month billing dashboard figure. Distinct student counts group by studentId; group totals count a student once within each group. Adding group debtor counts is not a tenant distinct count. Summary aging amounts sum to outstanding; overdue aging amounts sum to overdue. All monetary values are integer UZS; unsafe summary totals fail with TOTAL_LIMIT.

## Read API

All endpoints use existing cookie authentication, active tenant checks, role middleware, no-store response headers and JSON error conventions. Owners/admins have read/export access only within their tenant. Teachers and platform super admins receive 403, including exports. No client tenant is accepted.

| Method | Endpoint | Response |
| --- | --- | --- |
| GET | `/api/debts` | Paginated `charges`, total, page, pageSize, asOf, timezone |
| GET | `/api/debts/overdue` | Same, restricted to overdue buckets |
| GET | `/api/debts/students/:id` | Same plus filtered student summary; scoped missing student returns 404 |
| GET | `/api/debts/summary` | Outstanding/upcoming/overdue amounts, three overdue aging amounts, distinct debtor counts, asOf, timezone |
| GET | `/api/debts/groups` | Paginated group balances, aging and distinct counts |
| GET | `/api/debts/export` | UTF-8 BOM CSV of all matching charges, maximum 5000 |
| GET | `/api/dashboard` | Adds `debts` summary for owners/admins only |

Common strict filters: `search` (student name tokens, max 100 chars, escaped literal matching), `studentId`, `groupId`, `month` (billing month), `status` (upcoming, overdue, 1-7, 8-30, 31+), `minAmount`, `maxAmount` (remaining amount, inclusive, integer 0–1 trillion), `sort` (dueDate or remainingAmount), `order` (asc/desc), `page` (1–10000), `pageSize` (1–100, default 20). Encode `31+` as `31%2B`. Unknown fields, invalid IDs and reversed ranges fail validation. On `/overdue`, upcoming is rejected. Student route identity overrides the optional query studentId.

Rows sort with an ObjectId tie breaker. Group due-date sorting uses the earliest matching due date; balance sorting uses total matching outstanding amount. Group filters operate on charge rows before grouping. Exports honor filters and sorting but ignore pagination, returning the complete matching set or an explicit EXPORT_LIMIT error; there is no silent truncation.

## Query and security controls

All matching and joins are tenant scoped, including payment-to-charge/student and reversal references. Aggregations run in snapshot transactions so concurrent payment changes cannot create internally mixed ledger results. No report writes to financial history. Tenant/cancelled/dueDate and tenant/cancelled/group/month charge indexes are provisioned through existing startup index creation; payment/reversal lookups use existing tenant/charge and tenant/payment indexes. Names are projected server-side; no personal or financial data is logged.

Queries have a 15 second database execution limit. Responses and CSVs are bounded. CSV cells are quoted with double-quote escaping and an apostrophe prefix for formula-like leading content, including leading whitespace/control characters. The download name is a fixed ASCII filename; response headers contain no client input. Existing CSRF/write protections are unchanged.

## UI and manual checks

1. Sign in as an owner or admin. Open **Qarzdorlar**, **Muddati o‘tgan to‘lovlar**, and **Guruhlar bo‘yicha qarzlar**. Confirm dashboard outstanding and overdue figures are separate.
2. Use synthetic unpaid, partial, paid, cancelled and discounted charges; check remaining amounts and currency formatting. Record/reverse a payment through the existing financial profile and refresh the reports.
3. Search by name, search/select groups (options are paginated), filter billing month, aging, min/max amounts. Sort dates/balances and navigate report pages. Check group totals and student details against charge rows.
4. For a student with charges in multiple groups/months, verify tenant distinct debtor counts remain one. Open **Moliyaviy profil** links from debt rows and student details.
5. Check due-day and next-day behavior at 23:59:59 / 00:00 Asia/Tashkent. Verify 7/8 and 30/31 day buckets.
6. Export CSV; open it in a spreadsheet with a synthetic formula-like group name. It must remain text. Refine filters when over 5000 rows.
7. Test narrow screens, loading, empty, failed request/retry and expired-session states. Tables scroll horizontally on mobile.
8. Sign in as a teacher and super admin: no debt navigation, financial dashboard stats or API access. A different tenant's student detail returns 404 and reports exclude its records.
9. Verify existing student/group/scheduling/billing flows. Do not deploy, merge or change credentials for this phase.

## Limits

Reports scan matching tenant charges and reconcile their ledgers; snapshot reads, indexes, bounded responses and execution deadlines favor correctness. Very large tenants may need further query tuning after production explain measurements. An export exceeding 5000 charges requires narrower filters. Reports show current collectible balances, not an historical as-of ledger, and do not reconstruct removed membership history. CSV detail is one row per charge; distinct debtor totals come from summaries. No reminders, collection automation, payroll or subscriptions are included.

## Verification and changed files

Verified on the Phase 3.1 main baseline `b791ed094560d05451248bf998c968170014765b`:

- `npm run typecheck`: passed, API and web.
- `npm test`: passed, 175 API tests and 29 web tests (204 total), 17 test files; zero failures. Includes existing Phase 1–3.1 regressions.
- `npm run build`: passed, API TypeScript and production Vite build.
- `npm audit --audit-level=high`: zero vulnerabilities.
- `npm audit --omit=dev --audit-level=high`: zero vulnerabilities.
- `git diff --check`: passed.

Added tests cover ledger/cache divergence, unpaid/partial/full/cancelled charges, reversals and history preservation, duplicate membership history, distinct debtor counts, group totals, zero/overpaid balance exclusion, exact aging and Tashkent/leap/year boundaries, foreign payment/reversal references, authentication, RBAC on every endpoint, cross-tenant IDOR, dashboard restrictions, pagination/filters/sorting, CSV quoting/formula protection, UI loading/empty/errors/retry, links, filters, sorting, pagination, group rendering and export errors. Manual browser acceptance remains the checklist above.

Files changed:

- `apps/api/src/debts.ts`: reporting pipeline, APIs, CSV and summary service.
- `apps/api/src/debt-validation.ts`: strict validated report filters.
- `apps/api/src/billing-models.ts`: tenant charge report indexes.
- `apps/api/src/app.ts`: authenticated routes and dashboard integration.
- `apps/api/package.json`: includes debts in integration test command.
- `apps/api/tests/debts.test.ts`: synthetic financial/security integration tests.
- `apps/web/src/Debts.tsx`: Uzbek debt pages and dashboard cards.
- `apps/web/src/Debts.test.tsx`: UI regression tests.
- `apps/web/src/App.tsx`: guarded navigation/routes and dashboard cards.
- `apps/web/src/styles.css`: responsive debt tables and controls.
- `packages/contracts/src/index.ts`: debt response contracts.
- `docs/phase-3.2-debts.md`: accounting policy, APIs, limits, verification and manual checklist.

No deployment, merge, Render environment change or Atlas credential change was performed.
