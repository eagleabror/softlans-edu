# Phase 4.2 — Teacher payroll

Extends the existing application from main 9d0c2a6 (Phase 4.1).
No bank transfers, tax, subscription, messaging or hosting configuration changes.

## Access and security

Only business owners manage tenant payroll. The existing role model has no safe
payroll permission delegation, so admins are denied all payroll endpoints, including
read endpoints. Super admins have no tenant payroll access. Teachers see only their
own non-draft statements and associated payouts; source financial transaction IDs
and management audit snapshots are omitted from teacher responses.

Authentication uses the existing JWT HttpOnly cookie, active tenant/user checks,
session revocation and Origin/JSON CSRF middleware. All supplied identifiers are
validated and combined with the authenticated tenant. Request bodies are strict;
tenantId and monetary totals cannot be supplied by clients. Logs use existing
metadata-only error reporting. Audit records intentionally contain private salary
snapshots in the database; they are owner-only through the API.

All financial mutations, calculation previews and reports use MongoDB snapshot
transactions, majority writes, and the existing per-tenant billing write lock.
This serializes them with billing changes and teacher reassignments. Collections
and unique indexes are registered in ensureIndexes (normal application startup).
Unique indexes enforce one payroll per tenant/teacher/month, payout idempotency
keys per tenant, and one reversal per payout. No financial delete endpoint exists.

## Formula and effective-date policy

Payroll months use Asia/Tashkent [local first day 00:00, next month first day
00:00). All money is integer UZS. Percentages accept at most two decimal places.
For each rule/group subtotal:

    salary = floor((basisUZS * percentageHundredths + 5000) / 10000)

BigInt arithmetic prevents multiplication drift; totals reject unsafe integers.
Rounding is half up per group, then salaries are summed.

* Collected: sum original Payment.amount allocated to eligible charges, with
  paidAt in the payroll month, excluding every payment with a PaymentReversal.
  Each payment has exactly one charge allocation; each ID is counted once.
* Billed: sum Charge.finalAmount (net discounts) for the billing month, excluding
  cancelled charges. The charge unique student/group/month index prevents duplicate
  memberships from producing duplicate pay. Membership rows and dashboard counts
  are never a salary source.
* Fixed: configured integer amount, without attendance/day-based proration.

Rules apply using the first local date of the payroll month. effectiveFrom must
be a month's first day; effectiveUntil is inclusive. Midmonth end dates affect the
next month's eligibility, not proration. Two active rules for the same teacher and
same scope cannot overlap, regardless of salary type. Group rules override the
default for that group. A fixed teacher default is paid once for any remaining
unoverridden assigned groups (or a teacher with no assigned groups). If every
assigned group has an override, the default is omitted. Group-specific fixed
rules pay once per assigned group, even without charges. A teacher default is
not multiplied by group count.

Rules are audited on creation/update/archive. Archiving is soft deletion.
Editing a rule changes previews and explicit draft recalculations only; it never
modifies an existing payroll automatically.

## Payment and teacher attribution

New charges snapshot payrollTeacherId from the group's teacher at charge
generation. Payment salary ownership follows that charge, not the collector,
student's present membership, current group teacher, or attendance teacher.

Late payments count in the month received, at that month's rule, for the original
charge teacher. Reassignment does not move already generated tuition to the next
teacher; subsequent new charges belong to the next teacher. This is a monthly
tuition ownership policy, not a lesson-based split.

Legacy charges lack historical teacher data. Until attributed, previews use the
current group teacher and flag legacyAttribution in the breakdown. Before an API
reassignment, existing unattributed charges are stamped with the outgoing teacher
inside the same transaction. Historical reassignments before this release cannot
be reconstructed. Owners must verify legacy attribution before approval.

A payment reversal or charge correction before preview/recalculation is reflected
in the result. A reversal recorded after approval does not mutate finalized
payroll; an owner must enter an explained correction in a later draft or reverse
the erroneous payroll after reversing all its payouts. Changes to paidAt are not
allowed by existing billing APIs. There is no automatic clawback.

## Lifecycle and corrections

POST drafts is idempotent by teacher/month: retries return the existing record.
Recalculation is explicit, draft-only, revision checked, and preserves adjustments.
Adjustments are append-only entries with signed amounts, mandatory reasons, actor
and timestamp; resulting payable cannot be negative. Approval requires confirmed
true and the observed revision. Concurrent approvals yield one success and one
conflict. A zero-payable approval becomes paid with zero payouts.

Approved calculationBasis, grossSalary, adjustments and finalSalary remain frozen.
Payouts are separate immutable records; their cache/status updates commit together.
The server recomputes net payouts from payout and reversal records before writes.
Payouts cannot exceed the approved final salary or target a draft/reversed payroll.
A UUID idempotency key is bound to the normalized payout, payroll and recording
actor by a SHA-256 fingerprint. Reuse with different data is rejected.

Payout reversal adds an immutable reasoned transaction and recalculates status.
Repeated reversal with the same reason is idempotent. Payroll reversal requires
zero net payouts and preserves the approved snapshot and audit trail via reversedAt;
status retains its historical lifecycle value, while UI displays Bekor qilingan.
A reversed payroll cannot receive new payouts and is excluded from active expenses
and liabilities. The original unique teacher/month record remains reserved.
Replacement pay is an explicitly explained adjustment on a later month's draft.

## Reports

Monthly summary distinguishes approved salary expense, actual net payouts applied
to those statements, and outstanding liability. It is a payroll-cohort report:
a March cash payout against February payroll is included under February payroll.
It is not a payout-date cashflow report. Month selection permits monthly comparison.
Teacher rows show final salary and net payouts. Group reporting contains attributable
gross salary only; teacher-wide fixed salary and all adjustments remain unattributed.
Unattributed adjustments can be negative. No payroll amounts are silently added to
the pre-existing tuition collection dashboard.

## API

All routes below are under /api/payroll.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | /rules | Paginated salary rules, optional teacherId |
| POST | /rules | Create rule with reason |
| PUT | /rules/:id | Replace rule fields with reason (scope immutable) |
| DELETE | /rules/:id | Archive rule with reason |
| POST | /preview | Calculate teacherId/month from source records |
| POST | /drafts | Idempotently create teacher/month draft, confirmed |
| GET | / | Monthly paginated statements, optional teacherId |
| GET | /summary | Monthly owner report, optional teacherId |
| GET | /:id | Statement and owner-only audit trail |
| POST | /:id/recalculate | Revision-checked draft recalculation with reason |
| POST | /:id/adjustments | Revision-checked signed adjustment with reason |
| POST | /:id/approve | Explicit revision-checked approval |
| POST | /:id/reverse | Reasoned payroll reversal, confirmed |
| POST | /:id/payouts | Record payout with UUID idempotencyKey, confirmed |
| GET | /:id/payouts | Own/owner payout and reversal history |
| POST | /:id/payouts/:payoutId/reverse | Reasoned immutable reversal, confirmed |

Rule types: collected, billed, fixed. Money maximum per submitted value: 10^12 UZS.
Calculation fails closed above 20,000 relevant source charges/payments per tenant
month. Lists use page/pageSize (20 default, maximum 100); source/audit history is
not paginated in this MVP.

## Manual acceptance

- [ ] As owner, create collected, billed and fixed rules with dates and group overrides.
- [ ] Reject overlap, invalid percentages, foreign tenant IDs and missing reasons.
- [ ] Preview known charges and late/reversed payments; verify half-up UZS totals.
- [ ] Reassign a group, receive a late payment, verify the original teacher retains it.
- [ ] Generate twice; verify one draft. Adjust, recalculate and inspect breakdown.
- [ ] Confirm approval; verify rule edits do not change the approved snapshot.
- [ ] Record two partial payouts, retry the same request, and attempt an overpayment.
- [ ] Reverse payout with a reason; verify retained history and restored liability.
- [ ] Reverse payroll with zero net payouts; verify exclusion from active totals.
- [ ] As teacher, see only own approved statements/history; reject owner endpoints.
- [ ] As admin/super admin, verify no payroll API or navigation access.
- [ ] Verify loading/error/retry/empty states, confirmation keyboard focus and Escape.
- [ ] Inspect 320, 390, 700, 768, 1024 and 1440px, zoom and long names/large amounts.
- [ ] Recheck existing students, groups, billing, debts, attendance and reports.

Visual browser acceptance is manual unless separately recorded. React tests cover
role-specific controls, filtering, errors/retry and explicit approval confirmation.

## Changed files

* API: payroll-models.ts, payroll-calculation.ts, payroll.ts (new);
  app.ts and models.ts register routes/collections/indexes.
* Billing: billing-models.ts and billing.ts snapshot charge teacher;
  groups.ts stamps legacy charges before reassignment.
* API tests: tests/payroll.test.ts; package.json includes payroll integration tests.
* Web: Payroll.tsx and Payroll.test.tsx (new); App.tsx registers role-gated
  navigation/routes; styles.css adds scoped responsive payroll styling.
* Documentation: this implementation and acceptance guide.

## Verification

Full regression run: 201 API tests and 40 frontend tests passed, including
12 payroll backend cases and 5 payroll frontend cases. Root typecheck, production
build and git diff --check passed. npm audit reported zero vulnerabilities.
Initial payroll tests identified a nullable optional-money validator bug; fixed
before the successful full run. No remaining test failures.

No browser automation tool was available; visual sizing, zoom, measured contrast
and real-browser dialog/drawer focus behavior remain manual acceptance items.
No deployment, Render setting, or database credential was changed.
