# Phase 6.5 — Pilot Launch & Financial Acceptance Audit

Audit sanasi: **2026-11-07 UTC**. Qaror: **NO-GO — haqiqiy 3–5 markazli pilotni hozir ochmaslik**.
Sintetik staging sinovlarini davom ettirish mumkin. Kod testlarining o‘tishi
production operatsion tayyorligini tasdiqlamaydi. Quyidagi majburiy gate’lar
yopilib, operator va markaz egasi dalillarni qabul qilgach yangi GO qarori kerak.

## Tekshirilgan versiya va chegaralar

GitHub’dan yangidan olingan `main`: **37026a253e687508d2bebdbfda8a609af963a9b5**.
Ancestry: Phase 6.6.1 PR #35 (`26bdc16`), 6.6.2 PR #36 (`09e2683`),
6.6.3.1 PR #37 (`be41564`), 6.6.3.2 PR #38 (`37026a2`).
[Commit dalili](../artifacts/phase-6-5/revision.txt).
Audit/fix branch: `audit/phase-6-5-pilot-readiness`; main’dagi natija va branchdagi
tuzatish natijasi quyida alohida ko‘rsatiladi. Keyingi main o‘zgarishlari bu auditga kirmaydi.

Mahalliy disposable staging: **MongoMemoryReplSet, MongoDB 7.0.24, bitta node,
loopback**, har suite uchun yangi baza. Alohida provision qilingan hosted staging
yoki haqiqiy 3–5 center capacity testi emas. Node 24.19.0, npm 11.9.0;
repository CI Node 22da ishlaydi. Uch sintetik tenantning har birida bittadan
owner/teacher/student bilan bir xil lifecycle bajarildi; mavjud suite’lar qo‘shimcha RBAC,
MFA, sessiya va boshqa tenant ssenariylarini tekshirdi.

Production bazasi, mijoz yozuvlari va production secretlari o‘qilmadi/o‘zgartirilmadi.
Pullik xizmat, merge, deploy yoki haqiqiy email/Telegram xabari yuborilmadi.
Yangi lifecycle va recovery harness’larida outbound `fetch` rad qilinadi va
chaqirilmagani tekshiriladi. Testlar operator bergan DB URI’dan foydalanmaydi.

## Acceptance checklist

**PASS** — aynan ko‘rsatilgan qamrovda bajarilgan va dalili bor.
**FAIL** — kutilgan mezon bajarilmaganligi kuzatilgan.
**NOT VERIFIED** — yetarli operatsion dalil yo‘q; PASS ham, isbotlangan nosozlik ham emas.
PASS qatorlari productionga avtomatik ko‘chirilmaydi.

| ID | Mezon | Holat | Dalil / chegarasi |
| --- | --- | --- | --- |
| A01 | Talab qilingan merge’lar joriy main’da bor | PASS | [revision.txt](../artifacts/phase-6-5/revision.txt), yuqoridagi to‘rtta merge |
| A02 | Main bazaviy regression | PASS | [main-tests.txt](../artifacts/phase-6-5/main-tests.txt): API 554 passed + 1 skipped; web 136 passed |
| A03 | Main CI | PASS | [GitHub run 42340489005](https://github.com/eagleabror/softlans-edu/actions/runs/42340489005), exact `37026a2`, completed/success; [metadata](../artifacts/phase-6-5/github-runs.json) |
| A04 | Main typecheck/build va dependency auditi | PASS | [typecheck](../artifacts/phase-6-5/typecheck-main.txt), [build](../artifacts/phase-6-5/build-main.txt), [all audit](../artifacts/phase-6-5/audit-all.json), [production audit](../artifacts/phase-6-5/audit-production.json): 0 zaiflik; bundle warninglari bor |
| F01 | Enrollment → lesson proration → bitta charge | PASS | [lifecycle testi](../apps/api/tests/pilot-financial-lifecycle.test.ts), [run](../artifacts/phase-6-5/lifecycle.txt): 3 markazda 300000 × 7/13 → 161538; enrollment API va billing preview orqali |
| F02 | Partial payment, parallel duplicate → debt va bitta cash receipt | PASS | Shu lifecycle: 100000 to‘lovdan keyin qarz 61538, parallel qayta so‘rov 200/201 va faqat bitta payment cash entry; [billing suite](../apps/api/tests/billing.test.ts), A02 |
| F03 | Kechikkan to‘lov original billing oyini o‘zgartirmaydi | PASS | Lifecycle: noyabrda 61538, oktabr receipts 100000 qoladi, joriy qarz 0; [management suite](../apps/api/tests/management-reports.test.ts), A02 |
| F04 | Refund asl paymentni saqlaydi, qarzni qaytaradi, bir marta cash reversal | PASS | Lifecycle: 100000 refundni ikki marta yuborishdan keyin qarz 100000; [cash/billing suite’lar](../apps/api/tests/cash.test.ts), A02; refund bu yerda to‘liq bitta payment reversalidir |
| F05 | Payroll scheduler draft yaratadi, approval/payout avtomatik emas | PASS | Lifecycle haqiqiy `/api/internal/payroll/run` routeri va barcha tenant cursorlari: 3 scheduled draft × 64615; draftdan payout 409, draftda cash yo‘q |
| F06 | Owner approval → partial payout → replay/reversal | PASS | Lifecycle: owner approve, payout 30000, replay 200; ikkita reversal so‘rovi 204/204, salary net 0; [payroll suite](../apps/api/tests/payroll.test.ts), A02 |
| F07 | Expense draft/confirm/void, tarix va tasnif | PASS | Lifecycle: operating expense 20000, voiddan keyin expense net 0; cash suite’da parallel confirm, immutable tarix, inactive accountga reversal va [management suite’da](../apps/api/tests/management-reports.test.ts) capital/prepayment/unclassified, A02 |
| F08 | Cash transfer ikki tomonli, atomik va P&L income emas | PASS | Lifecycle: 50000 transfer replay’i bilan net 0; cash suite’da concurrent transfer, ikki oyoqli reversal, overflow rollback, A02 |
| F09 | Kassa va P&L bir-biridan ajratiladi | PASS | Lifecycle oktabr: billed 161538, salary 64615, expense 20000 → taxmin 76923; oktabr cash 1080000; barcha tuzatishlardan keyin cash 1061538 |
| F10 | Hisobsiz va to‘liq bo‘lmagan manbalar yashirilmaydi | PASS | Lifecycle: hisobsiz 1000 payment → debt 99000, cash 1061538, UNALLOCATED_HISTORY; management suite: missing payroll/draft/orphan/broken transfer/empty/partial month/20k limit, A02 |
| F11 | Tarixiy charge teacher bo‘yicha payroll completeness — main | FAIL | H1: [regression-before.txt](../artifacts/phase-6-5/regression-before.txt), 2 failed / 22 passed; joriy group teacher tarixiy majburiyatni yashirishi mumkin |
| F12 | H1 minimal fix — audit branch | PASS | [regression-after.txt](../artifacts/phase-6-5/regression-after.txt): 24/24; immutable payrollTeacherId, faqat legacy uchun group fallback |
| S01 | Tenant/RBAC/MFA/session/Origin himoyalari | PASS | A02: billing/debts/payroll/cash/management/password/mfa suite’lari; lifecycle’da boshqa tenant expense IDsi 404 |
| S02 | Billing/payroll scheduler kodi va ishga tushirish yo‘riqnomasi bor | PASS | [billing workflow](../.github/workflows/tuition-billing.yml), [payroll workflow](../.github/workflows/payroll-monthly.yml), [billing runbook](phase-6.6.1-prorated-tuition.md), [payroll runbook](phase-6.6.2-automated-payroll.md); staging auth/retry/cursor testlari A02/F05 |
| S03 | Billing/payroll’ning kuzatilgan external runlari ishni bajargan | FAIL | [github-runs.json](../artifacts/phase-6-5/github-runs.json): billing 42313698490, payroll 42324040518 va 42300223463 — schedule/completed/**skipped**, success emas |
| S04 | Hozirgi deployment URL/secret mosligi va muvaffaqiyatli scheduled completion | NOT VERIFIED | Secret qiymatlari va production runtime o‘qilmadi; skipped job kelajak konfiguratsiyasini yoki boshqa runner yo‘qligini isbotlamaydi |
| S05 | Notification trigger va durable processor sintetik ishlaydi | PASS | [notification-scheduler tests](../apps/api/tests/notification-scheduler.test.ts): actual pending job mocked sender bilan; [reliability tests](../apps/api/tests/notification-reliability.test.ts), A02; real delivery emas |
| S06 | External notification schedule va real yetkazish | NOT VERIFIED | Trigger endpoint jadval yaratmaydi. Repo ichida notification cron workflow yo‘q; tashqi scheduler konfiguratsiyasi/lastCompletedAt dalili olinmadi |
| B01 | Sintetik native encrypted backup/restore va startup | PASS | [recovery.txt](../artifacts/phase-6-5/recovery.txt): 3/3, 56 kolleksiya, recoveryMs 4386; populated payroll/payout/expense/cash hamda tuition, hujjat/index tengligi startupdan oldin, API smoke va SIGTERM |
| B02 | Production backup schedule, retention, offsite/key access, real restore, RPO/RTO | NOT VERIFIED | Faqat [taklif siyosati](runbooks/backup-policy.md) mavjud; bu auditda authorized real operational drill bo‘lmadi |
| E01 | Password reset xavfsizligi va gateway adapter xato holatlari | PASS | [password-security tests](../apps/api/tests/password-security.test.ts), A02: hash/expiry/single use/revoke/concurrency/redirect/timeout/config fail closed; gateway mocked |
| E02 | Haqiqiy recovery email inbox, SPF/DKIM/DMARC, bounce | NOT VERIFIED | [email runbook](phase-6-4-3-1-password-security.md); 2xx va DELIVERY_VERIFIED flagi delivery dalili emas; xabar yuborilmadi |
| O01 | Hosted staging, brauzer UAT, 5 markazli capacity, uptime/on-call alert yetkazish | NOT VERIFIED | Ushbu ish API/disposable DB auditi; avvalgi fazalar skrinshotlari bu auditda qayta bajarilgan UAT dalili emas |
| V01 | Yakuniy audit branch to‘liq regression | PASS | [final-tests.txt](../artifacts/phase-6-5/final-tests.txt): API 557 passed + 1 skipped, web 136 passed; jami 693 passed |
| V02 | Yakuniy typecheck/build | PASS | [typecheck-final.txt](../artifacts/phase-6-5/typecheck-final.txt), [build-final.txt](../artifacts/phase-6-5/build-final.txt): exit 0; mavjud bundle/import warninglari saqlangan |

## Aniqlangan blockerlar

| ID / daraja | Natija va xavf | Yopish sharti / mas’ul |
| --- | --- | --- |
| C1 — CRITICAL operatsion gate | Production restore va yo‘qotish oynasi NOT VERIFIED. Moliyaviy yozuvlar yo‘qolganda tiklash kafolati yo‘q. Bu backup ishlamaydi degan isbot emas | Owner + DB operator: tasdiqlangan backup usuli/xarajat/retention/IAM/KMS, completed recovery point va alohida ruxsatli isolated drill; actual RPO/RTO qaydi |
| H1 — HIGH kod | Main P&L joriy group.teacherId ishlatadi. Eski o‘qituvchi payroll’i yo‘q bo‘lsa ham yangi o‘qituvchi payroll’i bilan raqamli foyda chiqishi mumkin; aksincha to‘g‘ri tarixiy payroll’da yolg‘on warning | Minimal fix shu branchda; reviewer qabul qilishi va keyinchalik operator tasdiqlagan release’da exact SHA tekshirilishi kerak. Bu audit merge/deploy qilmaydi |
| H2 — HIGH operatsion | Kuzatilgan billing/payroll cronlar skipped. «Avtomatik hisoblanadi» deb pilot boshlash noto‘g‘ri | SRE: URL variable + mos backend/Actions secret mavjudligini qiymatsiz tekshirish; sintetik stagingda due run, barcha cursor, created/skipped/preserved/exceptions, ikkinchi replay va timeout/retry dalili |
| H3 — HIGH operatsion | Notification external tick/completion NOT VERIFIED. 202ni delivery deb qabul qilish xavfi | SRE: tashqi scheduler egasi/intervali, heartbeat va completed timestamp, durable job terminal status; rozilikli alohida delivery drill faqat yangi ruxsat bilan |
| H4 — HIGH operatsion | Self-service password email delivery NOT VERIFIED; foydalanuvchi hisobiga qayta kira olmasligi mumkin | Auth operator: tasdiqlangan gateway/from/domain, staging inbox+expiry/single-use test dalili; yoki pilot uchun egasi qabul qilgan, shaxsni tekshiruvchi va auditli support recovery tartibi. Tekshirmasdan verified=true qo‘ymaslik |
| M1 — MEDIUM moliyaviy nazorat | cashAccountId ixtiyoriy, default kategoriyalar unclassified; cash/P&L completeness avtomatik tasdiqlanmaydi | Markaz egasi: yangi tushum/payoutga hisob tanlash, openingni sanash, kategoriya defaultini belgilash, kunlik allocation/reconciliation; tarixni taxmin bilan backfill qilmaslik |
| M2 — MEDIUM operatsion | Monitoring/on-call va release konfiguratsiyasi tasdiqlanmagan; render.yaml hali demo/foundation branchini ko‘rsatadi, jonli holat sifatida ishlatib bo‘lmaydi | SRE: actual release SHA/Node22/replica set/indexlar, /health va /ready tashqi probe, alert egasi va incident escalation dalili; eski blueprintni ko‘r-ko‘rona apply qilmaslik |
| M3 — MEDIUM siyosat | Hisobot boshqaruv taxmini; yetishmayotgan bitta invoice’ni barcha holatda avtomatik topmaydi. Tasdiqlangan payroll refund/late receipt’dan so‘ng o‘z-o‘zidan qayta yozilmaydi | Owner/auditor: membership-charge coverage va salary source reconciliation; approved snapshotdan keyingi farqni alohida sababli correction sifatida ko‘rib chiqish; qoidani yozma qabul qilish |

Tasdiqlangan CRITICAL kod nuqsoni topilmadi. C1 — ma’lumotni yo‘qotishga qarshi
majburiy operatsion gate; H1 — takrorlangan kod nuqsoni. NOT VERIFIED bandlarni
nosozlik aniqlangandek talqin qilmaslik kerak. H1dan tashqari yangi feature,
migration yoki moliyaviy hujjatni o‘zgartiruvchi kod qo‘shilmadi.

## Minimal fix va audit dalillari

`management-reports.ts` Charge projection’iga `payrollTeacherId` qo‘shildi;
expected teacher `c.payrollTeacherId ?? group.teacherId` bilan tanlanadi.
Bu mavjud payroll-calculation siyosatiga mos. Yozish, backfill, yangi endpoint,
permission yoki hisoblash summasi o‘zgarishi yo‘q. Ikkita regression eski
o‘qituvchi yetishmasligini, uning to‘g‘ri payroll’ini va legacy fallbackni tekshiradi.

Yangi lifecycle testi bitta zanjirni uch tenantda haqiqiy APIlar bilan bajaradi.
Recovery testi populated payroll/payout/expense/cash’ni ham restore inventariga
qo‘shadi. Test fixture uchun model yozuvlari faqat yangi lokal bazada yaratiladi.

Yakuniy branch natijalari va qayta bajarish buyruqlari:
[dalillar indeksi](../artifacts/phase-6-5/README.md).
Native drill odatiy `npm test`da ataylab skipped; faqat alohida
`npm run test:recovery` muvaffaqiyati B01ga dalil bo‘ladi.

## Schedulerlar: konfiguratsiya va execution farqi

| Jarayon | Repo konfiguratsiyasi | Ushbu auditda bajarilgan | Operatordan qolgan dalil |
| --- | --- | --- | --- |
| Billing | `5 19 * * *` UTC = 00:05 Toshkent; URL mavjud bo‘lsa opt-in; current month, 10 tenantlik batch | A02: auth/manual-scheduler concurrency/idempotency; enrollment F01; GitHub external run skipped | Staging va keyinchalik tasdiqlangan pilot URL/secret mosligi; har due sanadagi completed job va tenant/charge sonlari |
| Payroll | `*/15 * * * *`; default keyingi oyning 1-kuni 00:15 Toshkentdan oldin due emas; 10 teacher/tenant, cursor | F05: uch tenantdan draft; A02: not_due, exception, retry/cursor; GitHub external run skipped | Barcha cursor tugagan, exceptions=0; approved/payout faqat owner qarori; completed run va keyingi tick dalili |
| Notification | `/api/internal/notifications/run`, alohida secret; repo cron yo‘q; tashqi tick zarur | A02: mocked delivery va concurrency/lease/restart xatti-harakati | HTTP202dan keyin processor completed, backlog/unknown nazorati va ruxsatli haqiqiy delivery dalili |

Amaliy runbook: [billing](phase-6.6.1-prorated-tuition.md),
[payroll](phase-6.6.2-automated-payroll.md),
[notification setup](render-free-notification-scheduler.md),
[notification recovery](runbooks/notification-recovery.md),
[monitoring](runbooks/production-monitoring.md).
Notification setup hujjatidagi eski release/«scheduled workflow yo‘q» kuzatuvi
tarixiy: bugungi main’da billing va payroll workflowlari bor.

Operator har jarayon uchun mas’ul, tick/vaqt zonasi, last successful completion,
exception soni va dalil URLini yozsin. GitHub cron aniq vaqt SLOsi emas — kechikish
bo‘lishi mumkin. Billing faqat joriy oyni oladi: oy to‘liq o‘tkazib yuborilsa,
o‘sha oy owner tomonidan ko‘rib chiqilgan manual generation bilan tiklanadi.
Faol har tenantda faol owner bo‘lsin: billing batch owner topolmasa xato bilan
to‘xtaydi; sababni hal qilib replay qiling, charge’larni o‘chirmang.
Payroll exceptions yoki `processing` tugamasa keyingi cursor/tuzatish zarur.
Notification `unknown`ni ko‘r-ko‘rona qayta yubormang.

## Backup, restore va password recovery amaliyoti

Synthetic drill: native Tools 100.14.0, AES-256-GCM, yangi bo‘sh target,
korrupt arxivni rad qilish, inventory/index tengligi, tenant login/RBAC,
debt=600, salary approved=100/paid=40/outstanding=60, cash=5260,
expense=100/confirmed va yangi API process startup/shutdown tekshirildi.
4386 ms — kichik lokal drill ichidagi restore+tekshiruv vaqti;
**production RTO emas**. Provisioning, katta hajm, concurrent writers,
oplog/PITR, retention, offsite, IAM va favqulodda KMS kirishi sinovdan o‘tmadi.
Production backup **NOT VERIFIED** bo‘lib qoladi.

[Backup siyosati](runbooks/backup-policy.md) va [restore runbook](runbooks/database-restore.md)
bo‘yicha owner usul/budjetni tasdiqlasin. RPO≤24h/RTO≤4h hozircha maqsad,
kafolat emas. Haqiqiy operational drill uchun alohida ruxsat va yangi isolated
target kerak; ushbu audit ruxsati production eksport/restorega yetmaydi.
Backupdan yangi valid yozuvlarni ustidan yozish va productionga restore qilish yo‘q.

Password recovery defaultda o‘chiq va provider/delivery attestatsiyasi bo‘lmasa
fail-closed. Operator tanlangan gateway `{from,to,subject,text}` kontraktiga mosligini,
TLS/secret storage, SPF/DKIM/DMARC, inbox/spam/bounce va tokenni log/click trackingga
chiqarmaslikni tekshirsin. Faqat rozilikli alohida testdan keyin delivery flagi va
recovery yoqiladi. Super Admin uchun public email recovery yopiq;
[operator recovery](phase-6-4-3-1-password-security.md) tartibi alohida.

## Operatorning pilot oldi va kundalik acceptance tartibi

1. Reviewer H1 fixini ko‘rib chiqadi. Release operatori keyingi alohida ruxsatda
   approved SHAni tanlaydi; deployni ushbu audit PRsi bajarmaydi.
2. DB operator C1ni yopadi, backup egasi va recovery point yoshini kuzatadi.
   Restore dalili yo‘q bo‘lsa haqiqiy moliyaviy yozuv qabul qilinmaydi.
3. SRE H2/H3/M2 uchun sintetik hosted staging dalilini yozadi: URL/secret
   mavjudligi, completed run, replay, index/readiness, tashqi downtime/DB alerti.
4. Auth operator H4ni yopadi yoki qabul qilingan support recovery tartibini mashq qiladi.
5. Har markaz egasi teacher/salary rule, membership, schedule, chegirma,
   opening/cash-bank qoldig‘i va expense tasnifini tekshiradi; M1/M3ni imzolaydi.
6. Egalar va operator 3 markazdan boshlash, 5ga kengaytirish mezoni, support va
   hisob-kitob farqida yozuvni vaqtincha to‘xtatish tartibini kelishadi.
   Hosted/brauzer UAT va 5-center capacity hozir NOT VERIFIED.
7. Har kuni: active membership ↔ charge, Payment−reversal ↔ Charge.paidAmount/debt,
   approved payroll ↔ payout−reversal, cash account entrylari ↔ sanalgan cash/bank,
   expense holati/tasnifi va P&L warninglarini taqqoslang. Salaryni yana expense
   sifatida kiritmang; transfer/opening/manual loan-like kirimni revenue deb olmang.
8. Har oy: payroll draft source/late refundni owner ko‘rib approve qiladi;
   cutoffli P&L/CSVni arxivlaydi, invoice/payroll coverage’ni alohida tasdiqlaydi.
   Farq bo‘lsa balancing yozuv uydirmang; sabab, original ID va correctionni saqlang.

## Takrorlanadigan amaliy ssenariylar

| Ssenariy | Kutilgan tekshiruv |
| --- | --- |
| 16-oktabr 09:00, Dush/Chor/Juma 10:00 jadval, fee 300000 | 13 umumiy / 7 qolgan dars; charge 161538, proration 138462; qayta enroll/generate yangi charge yaratmaydi |
| 100000 naqd partial, o‘sha UUID bilan parallel retry | Bitta Payment va bitta cash receipt; debt 61538; boshqa payload bilan UUID collision rad |
| Qolgan 61538ni 2-noyabrda qabul qilish | Oktabr billed/receipts o‘zgarmaydi; noyabr receipts 61538; joriy debt 0 |
| 40% billed salary, scheduler retry | Draft 64615 bir marta; draft/approval cash emas; approvaldan oldin payout rad |
| Owner approve, payout 30000, retry va reversal | Payout bir marta, qolgan salary 34615; reversal bilan salary obligation 64615 va cash qaytadi |
| Birinchi 100000 payment refund, ikki marta retry | Asl yozuvlar saqlanadi; debt 100000; noyabrda −100000 receipt/cash correction |
| Operating expense 20000 va noyabrda void | Oktabr operating 20000, noyabr −20000; asl xarajat oyi saqlanadi |
| Cash→bank 50000, duplicate va ikki tomonli reversal | Umumiy cash o‘zgarmaydi, P&L income=0; yarim transfer/overflow to‘liq rollback |
| Barcha tuzatishlardan keyingi reconciliation | Net tuition 61538, salary net0, expense net0; opening1000000 → closing1061538 |
| Cash hisobsiz 1000 payment | Debt99000, cash1061538; UNALLOCATED_HISTORY, sun’iy allocation yo‘q |
| Missing payroll / draft expense / legacy unclassified / orphan / broken transfer | Tegishli warning yoki REPORT_LIMIT; incomplete monthda definitive profit yo‘q; invoice completeness operator tomonidan ham tekshiriladi |
| Group teacher almashtirish | Charge snapshotidagi eski teacher payroll’i talab qilinadi; missing bo‘lsa estimatedResult=null (H1 fix branch) |
| Recovery provider timeout yoki service restart | Generic response delivery emas; failed token yaroqsiz, cooldowndan keyin qayta urinish; real inbox alohida drill |

20 000 source/report limiti kichik pilot uchun ham kuzatilsin; limitda 422 beriladi,
qisman total chiqarilmaydi. Buxgalteriya sertifikatsiyasi, depreciation, prepayment
release, soliq hisobi yoki haqiqiy bank pul yuborishi ushbu qabulga kirmaydi.
