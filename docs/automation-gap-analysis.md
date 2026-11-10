# SoftLans Edu 2.0 — Phase A–F GAP tahlili

Tekshiruv: 2026-11-10 UTC. Asos: remote `main`
`ed3156b3b2f20cd2d207c12df92e7d6b17c98e59`, kod va testlar.
[PR #44](https://github.com/eagleabror/softlans-edu/pull/44) **MERGED**,
`mergedAt=2026-11-10T15:16:04Z`; taxmin qilinmadi, GitHub’dan tekshirildi.
[Main CI](https://github.com/eagleabror/softlans-edu/actions/runs/42842569430):
verify, all/production dependency audit va automation-safety — success.
Eski CI xatolari joriy commit natijasiga tenglashtirilmagan.

Holat belgisi kod imkoniyatini bildiradi. **Production’da to‘liq ishlayotgani
tasdiqlangan avtomatlashtirish yo‘q**: deployed SHA, real scheduler completion,
delivery va backup dalillari olinmadi. Render Blueprintdagi eski branch/tarif
qiymatlari jonli Dashboard dalili emas. GitHub Actions variables/secrets
metama’lumotlari API’si ushbu integratsiyaga 403 qaytardi; qiymatlar olinmadi.

| Phase/modul | Koddagi holat va qayta ishlatiladigan qism | GAP / acceptance gate |
| --- | --- | --- |
| A — backup | Qo‘lda chaqiriladigan sintetik avtomatik drill: `tests/recovery.test.ts`, `tests/helpers/recovery.ts`; native dump/restore, AES-GCM, indeks/BSON/moliya/RBAC tekshiruvi. Backup policy va restore runbook bor. | Joriy PR: CI drill + xatoda ham maxfiy ma’lumotsiz hisobot, parallel archive himoyasi testi, readiness checklist. Production backup job, offsite, retention, key recovery va real restore tasdiqlanmagan. |
| B — billing | Scheduler kodi tayyor: `tuition-service.ts`, `tuition-scheduler.ts`, `billing-calculation.ts`, `billing-lock.ts`, `tuition-billing.yml`. Faol membership/student/group, jadval va qo‘shilish bo‘yicha proratsiya; unique student/group/month + transaction/tenant lock; manual saqlangan. | Oxirgi [scheduled run](https://github.com/eagleabror/softlans-edu/actions/runs/42739550957) skipped. URL/secret va production faolligi noma’lum. Created/skipped javob bor; doimiy scheduler run/error tarixi va admin uchun barcha natijalar acceptance’i yetarli isbotlanmagan. B’da qayta baholash; bu PR’da o‘zgarish yo‘q. |
| C — payroll | Scheduler/qoralama kodi tayyor: `payroll-automation.ts`, `payroll-calculation.ts`, `payroll-notifications.ts`, `payroll-monthly.yml`, `PayrollAutomation.tsx`. Fixed/collected/billed, yopilgan oy, exceptions, cursor/retry, unique tenant/teacher/month, owner status va consentli xabarnoma bor. Approve/payout faqat owner qo‘lda. | Oxirgi [scheduled run](https://github.com/eagleabror/softlans-edu/actions/runs/42800641362) skipped. Production config/closing policy va acceptance gate kerak. Ishlaydigan hisoblashni qayta yozish uchun dalil yo‘q. |
| D — Telegram | Avtomatlashtirish kodi bor: `notifications.ts`, `notification-automation.ts`, `daily-reports.ts`, `saas-reminders.ts`; debt offsetlari (muddat oldi/keyin), attendance, lesson, owner daily, 7/3/1 expiry. Consent/link/revision, lease, dedup, stale cancellation, retry/429 va history mavjud. | External trigger sozlanganini yoki 202 accepted’ni real delivery deb qabul qilib bo‘lmaydi. Scheduler completion/freshness va faqat ruxsatli test account/mock orqali acceptance dalili kerak. UNKNOWN_OUTCOME’da Telegram exactly-once kafolati yo‘q; qo‘lda reconciliation saqlansin. |
| E — Lead CRM | Qo‘lda ishlaydigan lead/follow-up/trial/history/statistics mavjud: `leads.ts`, `lead-models.ts`, `Leads.tsx`. Overdue bucket so‘rov paytida hisoblanadi. Tenant/RBAC va conversion transaction/audit bor. | Ichki staff reminder planner/job kind, trial oldi/keyingi result reminders va tenant automation settings ishlab chiqilmagan. Overdue avtomatik transition emas. Mavjud CRUD/history qayta ishlatiladi; marketing qo‘shilmaydi. |
| F — SaaS | Entitlement/read-only holati so‘rov paytida avtomatik: `saas-entitlements.ts`; `saas-reminders.ts` expiry planner bor. `saas.ts`/`saas-service.ts` va `SaasAdmin.tsx`: pending requests, Super Admin qo‘lda approve/reject, transaction/idempotent period extension. | Reminder scheduler production holati noma’lum. Click/Payme adapter/callback/reconciliation/refund kodi topilmadi; rasmiy talablar va sandbox alohida F doirasida o‘rganiladi. Merchant credentials yoki tasdiqlangan webhook bo‘lmasa gateway tayyor deb belgilanmaydi; inson tasdig‘i saqlanadi. |
| Cash | `cash-models.ts`, `cash-service.ts`, `cash.ts`: expense/account/movement; billing/payment/payroll ledger bilan transaction va idempotency mavjud. | Qo‘lda moliyaviy tasdiqlash saqlanadi; joriy recovery fixture cash/payroll summalarini ham tekshiradi. Real bank to‘lovi avtomatlashtirilmagan. |

## Endpoint, model va test xaritasi

`app.ts` auth kontekstini talab qiladigan routerlarni va alohida Bearer secret
talab qiladigan machine endpointlarni ajratadi. Secret yo‘q bo‘lsa scheduler 503;
secretni chetlab o‘tish yoki UI’dan tenantIdga ishonish qo‘shilmadi.

| Modul | Mavjud API/model | Asosiy testlar |
| --- | --- | --- |
| Billing | `/api/billing/charges/generate`, charges/payments/history/summary; `/api/internal/billing/run`; Charge, Payment, adjustment/reversal, Tenant.billingRevision lock | `billing.test.ts`, `billing-calculation.test.ts`, `scheduler-workflows.test.ts` |
| Payroll | `/api/payroll/automation/run`, `/automation/status`, rules/drafts/approve/payouts; `/api/internal/payroll/run`; SalaryRule, Payroll, SalaryPayout, PayrollRun/Item/Audit | `payroll.test.ts` (concurrent manual/scheduler, missing rules, rollback, consent); web `PayrollAutomation.test.tsx` |
| Notifications | `/api/notifications`, `/api/integrations/telegram`, `/api/internal/notifications/run`, Telegram webhook; GuardianLink, NotificationJob/Settings/History, TelegramIntegration/Delivery, processor lease/state | `notifications.test.ts`, `notification-scheduler.test.ts`, `notification-reliability.test.ts`, `daily-reports.test.ts`, `saas-reminders.test.ts` |
| Leads | `/api/leads`, `/api/trial-lessons`, `/api/follow-ups`; Lead, TrialLesson, FollowUp, LeadHistory | `leads.test.ts` (tenant/RBAC, history, timezone, transaction/concurrency) |
| SaaS | `/api/saas`, `/api/super-admin/saas/payment-requests`; Plan, Subscription, PaymentRequest, SaasAudit, TrialGrant | `saas.test.ts`, `saas-entitlements.test.ts`, `saas-reminders.test.ts`; web `SaasAdmin.test.tsx` |
| Cash/recovery | `/api/cash`, `/api/ready`; CashAccount, CashMovement, Expense/Category, barcha DB kolleksiya/indekslari | `cash.test.ts`, `recovery.test.ts`, `mongo-isolation.test.ts`, `pilot-financial-lifecycle.test.ts` |

Bu fayl dastlabki GAP auditidir; Phase A natijalari va keyingi bosqich gate’lari
[Phase A hisobotida](phase-a-backup-readiness.md). B–F kodini ishlab chiqish yoki
ularni production’da yoqish ushbu PR doirasiga kirmaydi.
