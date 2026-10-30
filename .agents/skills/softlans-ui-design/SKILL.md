---
name: softlans-ui-design
description: >-
  Guide frontend, dashboard, UI/UX, React component, Tailwind CSS, navigation,
  table, form, accessibility, and mobile responsive design work in SoftLans Edu
  2.0 (eagleabror/softlans-edu). Preserve its Uzbek-language forest-and-lime SaaS
  design, reuse existing patterns, and apply consistent tokens and interaction
  states when implementing, modifying, or reviewing UI.
---

# SoftLans Edu 2.0 UI design

Create a modern premium SaaS dashboard through calm surfaces, clear hierarchy,
readable data, and predictable interactions. Keep the interface minimal, soft,
clean, and professional. Preserve the working design where appropriate and
improve only the requested flow. This skill provides guidance; it does not itself
authorize a redesign, dependency migration, CRM functionality change, API/contract
change, or database model change.

## Workflow and repository baseline

1. Read the affected screen, its styles, existing tests, and applicable `AGENTS.md`
   before editing. Confirm data states, user roles, and mobile behavior.
2. Reuse the nearest working pattern. Briefly identify which layout, tokens, and
   components will be reused and which scoped accessibility gaps need attention.
3. Implement the smallest coherent UI change. Preserve event handlers, API calls,
   permissions, pagination, filters, validation rules, financial confirmations,
   and payment retry/idempotency behavior. Never replace real data with invented
   dashboard counts or change calculations to improve a visual.
4. Verify relevant states, keyboard operation, and responsive layouts; run the
   checks below. Report changes, checks, and any unverified visual behavior.

The following is the inspected baseline, not a guarantee that future files remain
unchanged. Re-read source before using a pattern:

| Source (relative to repository root) | Existing patterns to consult |
| --- | --- |
| `apps/web/package.json`, `apps/web/vite.config.ts` | React 19, React Router 7, Vite, Tailwind CSS v4 via `@tailwindcss/vite`, `lucide-react` |
| `apps/web/src/styles.css` | `@import "tailwindcss"`, `@theme`, shared classes, media queries, reduced-motion override |
| `apps/web/src/App.tsx` | `Shell`, `Dashboard`, `PageHeading`, `Stat`, `QuickLink`, auth, team dialog, permission-aware `NavLink` navigation |
| `apps/web/src/Students.tsx` | Search/filter/pagination, list/detail/form, field errors, archive dialog, success state |
| `apps/web/src/Groups.tsx` | Group forms, teacher selector, capacity, membership tables |
| `apps/web/src/Scheduling.tsx` | Schedule filters, weekly/list layouts, classroom forms, conflict feedback |
| `apps/web/src/Billing.tsx`, `apps/web/src/Debts.tsx` | Financial KPI cards, table sorting, filters, native modal, confirmations, Uzbek UZS formatting |
| `apps/web/src/*.test.tsx`, `apps/web/index.html` | Existing interaction tests; document already has `lang="uz"` |

Most components currently live inside feature files; there is no established
shared component library. Local helpers such as `Stat` and `Modal` are not all
exported. Extract a typed reusable React component only when required by the task
and actual reuse. Suggested future primitives are `Button`, `FormField`,
`StatusBadge`, `PageHeading`, `KpiCard`, `EmptyState`, and `Dialog`; do not claim
these already exist. Preserve native HTML semantics and allow `className`,
accessible names, disabled/busy states, and content composition as appropriate.

## 1. Colors and semantic design tokens

Keep the forest-green brand and pale lime accents. Current Tailwind theme tokens
are `--color-forest: #263e35`, `--color-lime: #d4e6ae`, and `--font-sans`.
Existing CSS also contains nearby hardcoded shades. The following aliases are a
recommended extension for future scoped implementation, not tokens already added
by this skill:

| Proposed Tailwind v4 token | Value | Meaning |
| --- | --- | --- |
| `--color-canvas` | `#f7f8f5` | Page background |
| `--color-surface` | `#ffffff` | Cards, inputs, dialogs |
| `--color-surface-muted` | `#fafbf7` | Quiet sections and table headers |
| `--color-content` | `#283c34` | Primary readable text |
| `--color-content-muted` | `#526b43` | Secondary text; verify each pairing |
| `--color-brand` | `#2b4438` | Primary action background, white text |
| `--color-brand-hover` | `#3a5748` | Primary action hover |
| `--color-accent` | `#d4e6ae` | Accent fill with dark forest text |
| `--color-line` | `#e7ebe2` | Decorative separators, not sole control boundaries |
| `--color-control-border` | `#7b847f` | Candidate visible input boundary on white |
| `--color-focus` | `#526b43` | Candidate visible keyboard focus on light surfaces |
| `--color-success` / `--color-success-soft` | `#3f5835` / `#edf2e5` | Confirmed success or active state |
| `--color-warning` / `--color-warning-soft` | `#846122` / `#fff3d8` | Paused or attention state |
| `--color-danger` / `--color-danger-soft` | `#9b503d` / `#fff7f2` | Errors or destructive actions |
| `--color-info` / `--color-info-soft` | `#263e35` / `#eef2e6` | Neutral information |

When tokens are needed, extend the existing `@theme` in `styles.css` to expose
utilities such as `bg-surface`, `text-content`, and `border-line`. Use
`var(--color-brand)` in shared CSS. Keep `forest` and `lime` compatible; avoid a
Tailwind v3 config or second token system. Replace hardcoded values only in the
affected scope. Existing `var(--primary, #6554c0)` and `var(--surface, #f3f6ef)`
fallbacks are not established semantic tokens; do not propagate them.

Use color with text/icons, never as the only status signal. Soft fills and faint
separators are decorative. Some existing muted text, small headers, and focus
colors need contrast review; do not treat every legacy color as accessible.

## 2. Typography

- Preserve the Inter / Segoe UI / Arial sans-serif stack and current 14px root.
  Inter is a fallback preference, not a guarantee of a downloaded font.
- Existing page headings are approximately 27–31px, section headings 14–19px,
  and KPI values 24–32px. Keep one `h1` and a logical heading order.
- For new or revised content, aim for body/control text 14–16px and supporting
  labels 12–14px, line-height 1.5–1.7; use 500–600 weight for emphasis. Do not
  copy legacy 8–10px text into essential instructions or table headers.
- Use a small, consistent type scale; avoid arbitrary size changes per card.
  Allow Uzbek names, apostrophes, and long labels to wrap. Use tabular numerals
  for amounts/counts; do not shrink important values until they are unreadable.

## 3. Spacing, surfaces, and hierarchy

- Prefer a 4px rhythm: 4, 8, 12, 16, 20, 24, 32, 40, 48px. Existing layouts
  include optical exceptions; preserve them unless the task needs adjustment.
- With the current 14px root, Tailwind's rem-based spacing is not a literal 4px
  grid (`p-4` is 14px). Use existing classes first; if exact new tokens are needed,
  define documented `--spacing-ui-*` values in `@theme` (for example
  `--spacing-ui-4: 16px`) rather than changing the root or global spacing unit.
- Use 16–24px card padding and 16–24px section gaps, with 16–18px mobile page
  gutters. Keep heading, filters, content, and pagination clearly separated.
- Match existing radii: controls 7–8px, panels/KPIs 10–12px, dialogs 14px.
  Prefer a light border; reserve soft shadows for raised surfaces. Existing modal
  shadow is `0 30px 100px #24392133`; avoid heavy shadows on every card.
- Extend `.panel`, `.page-heading`, and `.section-heading` before inventing new
  containers. Keep one clear primary action per section where practical.

## 4. Buttons and input fields

- Reuse `.button.primary`, `.button.light`, `.icon-button`, `.input-wrap`, and
  `.plain-input`. `.button` alone supplies geometry, not a complete secondary
  color treatment. Some debt markup uses `btn btn-primary` without matching
  definitions; do not adopt these as established button variants.
- Primary actions use forest/white; secondary actions use quiet surfaces with
  clear boundaries; destructive actions have explicit Uzbek labels and danger
  styling. Links navigate; buttons perform actions. Set non-submit buttons in
  forms to `type="button"`.
- Aim for at least 44px touch targets, including icon buttons. Existing buttons
  are typically 44px; inputs are 43–47px. Expand hit areas instead of enlarging
  every icon. Provide distinct hover, focus-visible, disabled, and busy states.
- Always keep a visible label, appropriate input type, help/error association,
  and usable focus indicator. Support textarea focus too. Placeholders supplement
  labels. Do not remove outlines without an equally visible replacement.
- While submitting, retain the action label/context (for example
  `Saqlanmoqda…`), prevent duplicate submissions, and keep layout width stable.

## 5. Sidebar and navigation

- Preserve `Shell`, workspace identity, user controls, route order, active
  `NavLink` styling, and all role-based visibility rules. Keep navigation labels
  in Uzbek and use `aria-current` for the active destination.
- Current sidebar is fixed at 251px on desktop, narrows at 900px, and becomes
  an off-canvas drawer at 700px. Keep content offsets synchronized with it.
- Mobile opener needs a meaningful name, `aria-expanded`, and a relationship to
  the drawer. Close on navigation and support Escape, close control, and overlay.
  For an obstructing drawer, manage focus, prevent focus behind it, restore focus
  to the opener, and prevent background scroll. Verify these behaviors when
  touching navigation; do not assume current markup already implements them all.

## 6. Tables and data grids

- Use native `table`, `thead`, `tbody`, `th scope="col"`, and cells; add an
  accessible caption/name. Avoid ARIA grid unless spreadsheet interaction is
  actually required. Preserve server sorting/filtering and pagination semantics.
- Reuse `.table-scroll`; `.table-wrap` is currently styled in specific feature
  scopes, so verify it actually scrolls on the affected screen. Contain horizontal
  overflow to the table. Make scroll regions keyboard reachable and named when
  necessary, without adding redundant focus stops.
- Keep headers readable, row padding consistent (roughly 12–16px), separators
  subtle, and row hover/focus unobtrusive. Left-align names; right-align numeric
  amounts with tabular numerals. Make row actions visible to keyboard and touch.
- Use real buttons for sortable headers; expose `aria-sort` on the active header.
  Keep pagination labels, result count, and disabled limits understandable.
- Never hide essential finance columns or actions solely to fit mobile. Use a
  scroll container for dense comparisons; use labeled stacked records only when
  they preserve every required field/action. Avoid duplicate accessible content.

## 7. Dashboard KPI cards

- Reuse `.stats-grid`, `.stat-card`, `.stat-top`, `.stat-icon`, and the `Stat`
  pattern. Finance and student variants already exist; allow grids to adapt to
  label/value length rather than enforcing a fixed count on every screen.
- Order content as label, value, unit/context, then optional comparison. Display
  actual API data; distinguish loading, unavailable (`—`), and genuine zero.
- Keep icon tiles quiet, baselines consistent, and contrast strong. Use one
  column on narrow screens where necessary, then two/three/four as space permits.
  Long UZS values must fit without clipping. Do not invent trends or time ranges.

## 8. Modal dialogs

- Follow the native `<dialog>` / `showModal()` patterns in billing and student
  flows; reuse `.member-dialog` or `.student-dialog` where appropriate.
- Provide a visible heading with `aria-labelledby` or a meaningful accessible
  name; associate a concise description. Focus a useful initial element, contain
  keyboard focus, restore focus on close, and support Escape and visible close.
- Match the 14px rounded white surface and soft backdrop. Keep at least 16px
  viewport gutters; constrain height to the viewport and scroll internal content
  so actions remain reachable with the mobile keyboard open.
- Preserve intentional busy-state cancellation restrictions and financial
  confirmation behavior. Explain pending work; do not trap users indefinitely
  after an error. Destructive confirmation names the affected record and action.

## 9. Form validation and feedback states

- Follow `StudentForm`: visible labels, native constraints, `aria-invalid`,
  field-level text connected by `aria-describedby`, and focus on a rejected field.
  Preserve server validation and business constraints; frontend checks assist it.
- Validate at submission or after a field has been visited, not on every initial
  keystroke. Preserve entered values on failure. Show a concise error summary
  when several fields fail and offer the next corrective action.
- Distinguish four shared states: loading (`Yuklanmoqda…`, `role="status"`);
  empty (`Ma’lumotlar topilmadi.` with an appropriate add/reset-filter action);
  error (`.notice`, `role="alert"`, useful retry); success (`.student-success`
  or `.success-note`, `role="status"`, only after confirmed completion).
- Differentiate no records from no filter matches. Never show empty success after
  a failed request. Preserve payment payloads across retries; a visual retry
  button must not trigger a different financial operation.
- Keep readable status text even when showing a spinner or skeleton. Reserve
  space to reduce layout shift; mark decorative skeletons/icons `aria-hidden`.

## 10. Mobile responsive patterns

- Design new layouts from a single-column small viewport upward using flexible
  grids, wrapping toolbars, `min-width: 0`, and full-width fields/actions as needed.
  Preserve existing desktop composition and CSS breakpoints when extending it.
- Current custom thresholds include 600/640px form stacking, 700px shell drawer,
  760px weekly schedule stacking, and 900px dashboard/sidebar adjustments.
  Tailwind defaults (`sm` 640px, `md` 768px, `lg` 1024px) are not identical;
  do not accidentally leave gaps between utility and existing CSS behavior.
- Keep the existing weekly schedule's mobile day-list approach. Filters stack;
  pagination wraps; financial tables scroll locally. Avoid fixed content widths,
  clipped actions, hover-only controls, and page-wide horizontal overflow.
- Inspect at 320, 375/390, 700, 768, 1024, and 1440px, plus either side of any
  changed breakpoint. Check long Uzbek names, large amounts, zoom, and keyboard.

## 11. Icons and animations

- Use the installed `lucide-react` icons, generally 16–20px for controls and
  20–24px for navigation/KPI tiles. Keep stroke weight and alignment consistent.
  Hide decorative icons from assistive technology; name icon-only buttons in Uzbek.
- Reuse `appear` (small 6px entrance) and `spin` only when helpful. Prefer subtle
  150–250ms color/opacity/transform transitions without layout movement or bounce.
  Existing entrance animation reaches 350ms; avoid adding motion to every update.
- Respect the existing `prefers-reduced-motion: reduce` override. Loading must
  remain understandable when animation is off. Do not add an animation library
  for simple transitions.

## 12. Accessibility and Uzbek content

- Meet WCAG 2.2 AA: text contrast at least 4.5:1 (3:1 for large text), meaningful
  control boundaries/icons and focus indicators at least 3:1 against adjacent
  colors. Measure actual foreground/background pairs including disabled, hover,
  focus, and status variants as applicable; palette names do not prove contrast.
- Ensure keyboard access, logical tab order, visible unobscured focus, semantic
  landmarks, a skip-to-content path when working on the shell, labels, and no
  keyboard traps. Meet 24px minimum target-size rules with 44px preferred for touch.
- Keep content usable at 200% text zoom and reflow at 320 CSS px (400% browser
  zoom on a 1280px viewport); dense data tables can scroll within their region.
- Keep `lang="uz"` and Uzbek Latin UI copy, including errors, tooltips, accessible
  names, and status messages: `Saqlash`, `Bekor qilish`, `Qayta urinish`.
  Use consistent `o‘` / `g‘` spelling and concise action-oriented wording.
- Reuse existing UZS and date formatting. Billing/debt instants use
  `Asia/Tashkent`; student date-only values currently use UTC to avoid date drift.
  Do not globally rewrite date semantics or stored values for visual consistency.

## 13. Design quality checklist and validation

- [ ] Scope is limited; CRM behavior, contracts, models, permissions, money/date
  semantics, and existing working flows remain intact.
- [ ] Existing components/classes and forest/lime identity are reused; any new
  tokens have semantic names and work with the current Tailwind v4 setup.
- [ ] Typography, spacing, radii, borders, shadows, alignment, and primary action
  hierarchy are consistent and calm; important text is readable.
- [ ] Tables have readable headers, usable row actions, correct sorting and
  pagination; forms retain labels, values, validation, and confirmations.
- [ ] Empty, loading, error/retry, success, disabled, and pending states are
  deliberate and in Uzbek; no fabricated data or success feedback.
- [ ] Narrow/mobile/desktop layouts, long content, large UZS values, zoom,
  overflow, keyboard focus, drawer/dialog behavior, contrast, and reduced motion
  have been checked for the affected UI.
- [ ] Relevant existing tests, type checks, and build have passed, or exact
  environment limitations and unverified behavior are reported.

Run checks from the repository root, using the existing npm lockfile/workspaces:

```sh
npm ci
npm run typecheck -w @softlans/web
npm run test -w @softlans/web
npm run build -w @softlans/web
git diff --check
```

Run `npm ci` only when dependencies need installation. For frontend behavior
changes, add or update meaningful React Testing Library tests near the affected
feature (labels, keyboard interaction, role visibility, error/retry, submission).
Use the existing Vite dev workflow for browser checks if available; unit tests do
not establish visual quality. Broaden to root workspace checks when shared code
changes. For documentation-only skill changes, validate YAML frontmatter, local
links/source references, checklist coverage, and diff scope; no UI build or
database-dependent test run is necessary. Never claim a check ran if unavailable.

## Explicit invocation

Future tasks can say: `Use $softlans-ui-design to improve the billing filters on
mobile while preserving existing behavior.` If skill discovery is unavailable,
ask Codex to read `.agents/skills/softlans-ui-design/SKILL.md` directly. Root
`AGENTS.md` also requires consultation for UI work without an explicit invocation.
