# Phase 3.1 — monthly billing and manual payment recording

## Behavior and accounting policy

- Extends existing authentication, tenant, student, group, scheduling and design architecture.
- One charge per tenant/student/group/month, enforced by a unique database index. A student can receive separate charges for multiple groups. Confirmed generation is transactional and safely repeatable.
- Generation uses currently active memberships, students and groups. Enrollment, student enrollment and group start dates must precede the end of the requested month. Full monthly fee is charged for any eligible enrollment during that month; no proration. Archived, paused and removed records are skipped, including retrospective generation. This phase does not reconstruct past membership status.
- Existing charges retain their fee snapshot when group fees change. Re-running generation never overwrites charges or corrections. Cancellation retains the original charge; re-running generation does not recreate it.
- Months use Asia/Tashkent. Due day defaults to 10, accepts 1–28, at local end of day; never precedes the latest enrollment/group/student effective timestamp.
- All money is integer UZS. API payment/adjustment amounts have a 1 trillion UZS per-operation ceiling; group fee constraints remain unchanged. Reports reject totals outside the safe integer range.
- Payments are immutable records. Only server identity supplies tenant, student (from charge), and recorder. There is no update/delete payment endpoint.
- A reversal is an append-only correction referencing the original payment, with actor, mandatory reason and timestamps. It is not a bank refund. Charge adjustments store before/after snapshots, reason, actor and timestamps. Charge generation records its actor.
- Paid balances are derived from payments minus reversals and cached on the charge inside the same transaction. Every financial write reconciles that charge from the ledger. No client balance/status is accepted. Remaining balance/status is derived server-side. A zero-fee charge is paid; a cancelled charge has no collectible balance.
- An original receipt is attributed to its paidAt month. Summary `receivedAmount` and `paymentCount` exclude reversed payments, including later corrections, so historic receipt totals are restated after reversal. They are not an accounting-period refund ledger. `billedAmount` and `outstandingAmount` refer to the selected billing month, regardless of receipt month.

## Authorization and transaction safety

Owners manage tenant finances, including adjustments/cancellations and reversals. Admins can read, generate and record payments. This phase deliberately grants no admin correction permission and does not add a new delegated-permission system. Teachers and platform super admins cannot access financial endpoints or financial dashboard data.

Every lookup, index and reference is tenant scoped. Cross-tenant detail/history/write references return 404. Unknown body/query fields are rejected; existing JWT verification, session revocation, active-tenant checks, JSON/origin CSRF checks and rate limiting remain intact. No request bodies or private financial details are logged.

MongoDB replica sets are required, as before. Financial writes use snapshot transactions and majority write concern. A tenant billing revision write serializes concurrent generation, payment recording, reversal, charge adjustment, enrollment/removal, student updates and group updates. The database driver retries transient transaction conflicts against a fresh snapshot. No process-local locks are used. Unique charge, idempotency and reversal indexes provide additional constraints. Collection/index creation runs through existing startup index provisioning.

POST payments requires a UUID `idempotencyKey`. Retries with the same canonical payload and recorder return the original payment (200); different payload/recorder returns 409. A first success returns 201. The browser preserves the exact payload and key after transport failure; retry does not generate a new key. Reversal retries with the same reason return the existing reversal and never subtract twice.

## API

All routes require existing authenticated cookies. Writes require JSON and the configured Origin. Responses follow existing JSON/error conventions.

| Method | Endpoint | Description |
| --- | --- | --- |
| POST | `/api/billing/charges/generate` | `{month:"YYYY-MM", dueDay?:10, confirmed:true}`; created/skipped counts |
| GET | `/api/billing/charges` | Filters: month (billing month), studentId, groupId, search, status; page/pageSize |
| GET | `/api/billing/charges/:id` | Charge with student/group names and adjustment audit snapshots |
| PATCH | `/api/billing/charges/:id` | Owner: originalAmount, discountAmount, cancelled (optional false), mandatory reason |
| POST | `/api/billing/payments` | chargeId, integer amount, method, ISO paidAt with offset, optional reference/note, UUID idempotencyKey, confirmed:true |
| GET | `/api/billing/payments` | Filters: month (receipt month), studentId, groupId, chargeId, search; page/pageSize; includes reversals |
| GET | `/api/billing/students/:id/history` | Same payment filters, forced tenant/student scope; history includes reversals |
| POST | `/api/billing/payments/:id/reverse` | Owner: `{reason, confirmed:true}` |
| GET | `/api/billing/summary?month=YYYY-MM` | Billed, valid receipts, outstanding balance and valid payment count; default current Tashkent month |
| GET | `/api/dashboard` | Adds current-month `financial` statistics for owners/admins only |

Statuses: unpaid, partial, paid, cancelled. Payment methods: cash, bank_transfer, click_manual. Payment history pagination includes reversed records; valid payment counts in summaries exclude them. Filters are strict and default pagination is 20, maximum 100.

## UI/manual acceptance

1. Run the existing replica-set development setup and sign in as an owner. Create synthetic students and active group memberships, including one student in two groups. Use enrollment/group dates inside or before the month being tested.
2. Open **To‘lovlar → Oylik hisob yaratish**, select month and due day, check explicit confirmation, generate. Repeat: no duplicate rows. Remove/archive membership/student/group and generate a future month: no new charge for it.
3. Search by student; filter month, group and status. Open the student's **Moliyaviy profil** from the student detail or charge row. Inspect desktop and mobile layouts.
4. Select **To‘lov qo‘shish**, enter a partial amount, method, local Tashkent timestamp, optional reference/note, and confirm. Observe partial balance, then pay the remainder. Overpayments and invalid integers must fail. Test a transport retry: it must return the same payment.
5. Open **To‘lov tarixi**. As owner reverse a payment with a reason. The original stays in history, annotated with its reversal; balance reopens. As admin correction controls are absent and direct correction requests return 403.
6. As owner use **Hisobni tuzatish**, supply reason and discount. Reducing below already paid funds or cancelling a paid charge fails until payments are reversed. Inspect audit using charge detail API.
7. Record a payment in a different calendar month from its charge. Receipt-month totals change for paidAt; billing-month billed/outstanding totals remain attributed to the charge. Dashboard never treats unpaid charges as received revenue.
8. Sign in as teacher, another tenant's owner, and super admin. Verify financial navigation/access restrictions and API isolation. Existing students, groups, classrooms and schedules remain usable.

## Validation and limits

`npm test` covers existing modules plus replica-set financial integration tests and frontend confirmation/retry/filter tests. `npm run test:integration` includes the new financial suite. Run `npm run typecheck`, `npm test`, `npm run build`, `npm audit --audit-level=high`, and `npm audit --omit=dev --audit-level=high`.

Known limits: full-month pricing only; no reconstruction of removed historical memberships; owner-only corrections; tenant-level financial write serialization favors correctness over high write throughput. Generation is one transaction and scans eligible memberships; very large tenants may need chunked jobs in a later phase. Reports read selected tenant-period records in memory and reject unsafe totals. No real payment gateways, automated collections, reminders, payroll, subscriptions, permanent financial deletion, deployment or credential changes are included.
