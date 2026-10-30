# Phase 3.3 — Financial analytics and reports

The existing SoftLans Edu application now exposes **Moliyaviy hisobotlar** at
`/reports` for business owners and admins. The page uses existing forest/lime
styles, responsive panels, seven KPIs, four Recharts bar charts with keyboard
support and native table alternatives, reporting presets/custom dates, searchable
paginated group options, sortable paginated group performance, and four CSV exports.
Loading skeletons, empty results, errors and retries use Uzbek copy. Chart code is
lazy loaded separately from the rest of the application.

## API

Authenticated GET endpoints under `/api/analytics`:

| Endpoint | Response |
| --- | --- |
| `/dashboard` | Period metadata, all KPIs/charts, paginated groups |
| `/summary` | KPIs |
| `/monthly-payments` | Monthly transaction totals, counts and cohort figures |
| `/billing-collection` | Monthly billed/allocated collection figures and transaction totals |
| `/debt-aging` | Four aging buckets |
| `/payment-methods` | Cash, bank transfer, manually recorded Click |
| `/groups` | Sorted, paginated group performance |
| `/export` | CSV for `report=monthly\|groups\|methods\|aging` |

Required: `start=YYYY-MM-DD&end=YYYY-MM-DD` (inclusive Asia/Tashkent dates).
Optional: `groupId`, `page` (1–10000), `pageSize` (1–100),
`sort=name|students|billed|collected|outstanding|rate`, `order=asc|desc`.
Unknown fields are rejected. Maximum interval: 366 inclusive days; future end dates
and invalid calendar dates are rejected. Dates touching part of a month select that
whole billing cohort; receipts still use only the exact selected dates. Monthly
series are zero filled, including months without transactions.

## Financial definitions

All money is integer UZS; no persisted analytics balances are introduced.

- **Payments received / count:** valid, non-reversed ledger payments whose `paidAt`
  falls in `[start midnight, day after end midnight)` in Asia/Tashkent. Referenced
  charge and student must match the same tenant; cancelled charges are excluded.
- **Billed:** sum of current `finalAmount` (net of discounts) of non-cancelled
  charges with billing months intersecting the selected dates. This is never
  labelled collected revenue.
- **Cohort collection:** valid payments allocated to those charges, with payment
  dates before the end cutoff, including payments before the selected start.
  Each charge's collection is capped at its net charge amount before summing.
- **Outstanding:** selected cohorts' billed amount minus capped collection.
- **Collection rate:** capped cohort collection / net billed amount, zero when
  billed is zero, capped at 100%. BigInt basis-point half-up rounding gives two
  deterministic decimal places without changing money units.
- **Overdue / debtors / aging:** all non-cancelled billing months through the
  selected final month, including older months outside the date filter. Balances
  use valid payments before the cutoff. A debtor is a distinct student with a
  positive balance across those charges, even when enrolled in multiple groups.
- **Aging:** Asia/Tashkent calendar-day difference between due date and selected
  end date: due today/future, 1–7, 8–30, or >30 days. Fully paid charges contribute
  zero. Due today is not overdue.
- **Group statistics:** financial figures belong to the charge's group, never
  multiplied by joining memberships. Student counts are distinct **current active
  members**, not historical enrollment snapshots. Groups with no charges return
  zero amounts. Global student counts must not be obtained by summing group rows.

Historical dates are payment cutoffs using **current** charge adjustments,
cancellations and reversal validity. They are not immutable accounting snapshots;
a later reversal invalidates the payment in earlier reports too. This convention
is shown on screen. Existing Phase 3.1/3.2 write behavior is preserved.

## Security and workload limits

Authentication runs before analytics RBAC; only `business_owner` and `admin` are
accepted. Teachers and Super Admins have no access, including CSV. Tenant identity
comes exclusively from the server principal. Every ledger, charge, reversal, group
and membership join carries tenant identity. No student names, identifiers, notes,
references or contact details are exported. Existing cookie, CSRF, global rate
limits and no-store headers remain in effect. Analytics adds 30 requests/minute
per IP. Every Mongo aggregation has a 15-second execution deadline with disk
spilling disabled; interval validation bounds transaction/cohort scans. All-history
debt intentionally includes older months, subject to the same deadline. Existing
compound tenant/date/group/charge indexes support the queries.

One snapshot transaction keeps a response internally consistent across concurrent
financial writes. Money totals are checked for safe numeric limits before percentage
calculation/serialization. Groups are bounded to 5000; larger tenants must choose a
group. This cap applies to the complete report and export; oversized reports fail
explicitly rather than silently truncating. CSV exports all matching groups, not
only the visible page, honors sorting, quotes all cells, prefixes risky formula
cells and includes a UTF-8 BOM and period metadata. Excel compatibility uses CRLF.

Limitations: focused endpoints currently share the complete report aggregation;
large tenants may need dedicated endpoint pipelines after profiling. Debt history
has a time limit rather than a lower date cutoff to avoid omitting real old debt.
No PDF, payroll, gateways, notifications, subscriptions, deployment or credential
changes are included.

## Changed files

- `apps/api/src/analytics.ts`: validation, ledger aggregation, APIs, CSV and RBAC.
- `apps/api/src/app.ts`: authenticated route mounting.
- `packages/contracts/src/index.ts`: shared report/group contracts.
- `apps/web/src/FinancialReports.tsx`: dashboard and charts.
- `apps/web/src/App.tsx`: role-aware navigation/route and lazy loading.
- `apps/web/src/styles.css`: scoped responsive reporting styles.
- `apps/web/package.json`, `package-lock.json`: Recharts dependency.
- `apps/api/tests/analytics.test.ts`: financial integration/security tests.
- `apps/web/src/FinancialReports.test.tsx`, `apps/web/src/App.test.tsx`: interaction,
  period, failure/retry and navigation tests.
- This document: semantics, operational limits and review checklist.

## Verification

Full suite: 181 API tests and 32 web tests passed, including Phase 1–3.2 regressions.
Root TypeScript typecheck and production build passed. Dependency audit reported
zero vulnerabilities (full and production-only audits). Chromium checks with API
fixtures passed at 320, 390, 700, 768, 1024 and 1440 pixels with no page
overflow or runtime errors; the chart table alternative was expanded successfully.
These checks do not replace production-data or assistive-technology review. Tests cover partial/full/cancelled/reversed payments, capped
collection, payment-date versus billing-month allocation, Tashkent boundaries,
aging edges, multi-group membership, zero-charge groups, empty datasets, rounding,
query validation, tenant isolation, every endpoint's RBAC, safe exports and chart
series consistency. Tests use a temporary MongoDB replica set, not Atlas.

## Manual testing checklist

- [ ] Sign in as owner and admin; open Moliyaviy hisobotlar and each CSV export.
- [ ] Try teacher and Super Admin accounts, including direct report/API URLs.
- [ ] Compare receipts with payment history for the exact selected local dates.
- [ ] Pay an older month's charge this month; verify receipts and cohort collection
      use their distinct time bases. Reverse it and refresh.
- [ ] Compare partial/full/cancelled charges and a multi-group student's figures.
- [ ] Exercise all presets, custom dates, month boundaries and group search pages.
- [ ] Check group sorting, pagination, zero-charge groups and full-filter CSV rows.
- [ ] Open all four exports in Excel; verify Uzbek headers, BOM, amounts and periods.
- [ ] Test keyboard chart navigation and the expandable chart tables.
- [ ] Test loading, empty, network error/retry and forbidden states.
- [ ] Check narrow/mobile/desktop, zoom, long group names and large UZS values.
