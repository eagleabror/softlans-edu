# SoftLans Edu Figma redesign

Baseline: origin/main 1d4c19a. Figma dashboard 0:3 inspected with design context and rendered screenshot; cover 2:2 excluded.

## Implementation plan
1. Inventory every route and authorization guard before changing UI.
2. Adopt Poppins, #FAFBFF canvas, #5932EA accent, #F2EFFF soft accent, white surfaces, spacious 24px cards and soft shadows. Retain logo and Uzbek copy.
3. Reuse native feature forms, tables, dialogs, CSS and installed Recharts; extract shared primitives where genuinely reused. Preserve handlers, API calls, tenant/RBAC and billing behavior.
4. Add 306px/102px desktop navigation and preserve accessible mobile drawer. Apply shared tokens to auth, onboarding, SaaS, CRM and platform screens.
5. Run the actual application with disposable MongoDB replica set and fictional records; capture role/route desktop/mobile screenshots and important states. Record failures honestly.
6. Run requested checks, create gallery, archives and reviewable PR. No merge or deployment.

## Verification
Machine-readable route inventory: `artifacts/redesign/route-inventory.json`. Final evidence and limitations are recorded in `artifacts/redesign/SCREENSHOT_INDEX.md`.

## Shared design system

`design-system.css` supplies semantic colors, typography, spacing, radii, shadows, responsive surfaces, buttons, inputs, selectors, filters, tabs, badges, table scroll regions, dialogs, notices and focus/reduced-motion states. Existing feature-native controls and event handlers are retained. `ui.tsx` exports PageHeading, Stat, DataTable, StatusBadge, EmptyState, ErrorState, LoadingSkeleton and ChartContainer. Authentication, onboarding, tenant SaaS and platform styles consume the same foundations. Poppins is self-hosted with its OFL license; no runtime font request is needed.

CRM Shell retains its existing mobile focus management and now supports a 306px/102px desktop sidebar. Super Admin has equivalent collapse/drawer controls, Escape dismissal, focus containment/restoration and background scroll lock. Both retain role-aware routing and authenticated session handling.

Dashboard analytics use `/analytics/dashboard` and existing attendance summary data. The contextual student table uses `/students` only for managers. The full set of original KPI information remains in an expandable section. No monetary calculations were moved into the UI.

## Verified integration fix

The existing classroom form submits `capacity: null` for an unspecified optional capacity. The API validation contract accepts null, but the Mongoose integer validator rejected it and returned 500. The classroom-only validator now accepts null or a safe integer, retaining its minimum/maximum bounds. `schedules.test.ts` covers the real request, including rejection of zero. No subscription, quota, permission or tenant logic was changed.

## Reproduce screenshots safely

Prerequisites: Node 22+, Chromium at `/usr/bin/chromium`, and Python 3 with Pillow.

```sh
npm ci
npm ci --prefix scripts/redesign
# Terminal 1: starts its OWN disposable MongoDB replica set and fictional records.
node_modules/.bin/tsx scripts/redesign/local-server.mts
# Terminal 2
npm run dev -w @softlans/web
# Terminal 3: requires /usr/bin/chromium (override executable path in harness if needed)
npm run capture --prefix scripts/redesign
npm run smoke --prefix scripts/redesign
python scripts/redesign/gallery.py
```

The harness never reads a production URI. It generates test-only sessions in `/tmp/softlans-redesign-fixtures.json`, which is not committed. Local test proxy configuration assigns separate synthetic client IPs to browser contexts so exhaustive verification respects the unchanged per-client rate limits. On termination, the replica set is stopped and discarded. Browser assertions supplement the existing React and API test suite; they do not establish accessibility certification or exact pixel equivalence.

## Handoff artifacts

- `artifacts/redesign/SCREENSHOT_INDEX.md`: linked desktop/mobile gallery and limitations.
- `artifacts/redesign/route-inventory.json`: actual route/role coverage, including dynamic records.
- `artifacts/redesign/screenshot-manifest.json`: screenshot paths, console errors, redirects and overflow results.
- `artifacts/redesign/ROUTE_CHECKLIST.md`: route-by-route verification checklist.
- `artifacts/redesign/smoke-results.json`: executed browser interactions and responsive checks.
- Desktop, mobile and combined ZIP files; labeled contact sheets; `gallery.html` for local browsing.
- `before-dashboard.png`: unmodified main rendered against fictional data. `figma-reference.png`: inspected reference only, never used in application rendering.

## Final validation

All 120 route/role combinations have desktop and mobile captures: 140 screen states, 280 PNG files, 0 missing captures, 0 unexpected console errors and 0 page overflow failures. All 398 API and 100 web tests pass. The 14 browser smoke checks, typecheck, build, both audits (0 vulnerabilities) and diff check pass. The build retains Vite’s non-blocking large-chunk warning. See `artifacts/redesign/VERIFICATION.md` for exact evidence and external integration limits.
