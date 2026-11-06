# SoftLans Edu 2.0 — 6.4.2: backup, recovery va xavfsiz release

Holat: **lokal sintetik recovery isbotlangan; production-ready emas**.
Audit bazasi `83bbdeb015c3518b5aa4597abc721d2a0f1c100c` — 6.4.1 merge.
2026-11-06 kuni origin/main remote SHA ham shu qiymat ekanligi tekshirildi.
Branch: `feat/phase-6-4-2-backup-recovery`. Production data/Atlasga ulanilmadi,
export, deploy, rollback API, secret almashtirish, pullik backup, schedule yoki
migration bajarilmadi. Narx, trial, tenant ruxsatlari va billing kodi o‘zgarmadi.

## Joriy holat auditi

| Soha | Mavjud dalil | Yetishmayotgan dalil/amal |
| --- | --- | --- |
| MongoDB | `db.ts`: yagona Mongoose ulanishi, 10s selection timeout, autoIndex false, replica set va logical session talabi. Tranzaksiyalar uchun standalone yaramaydi. | Jonli tier, versiya, TLS/network/IAM va backup holati tekshirilmagan. |
| Model/index | `models.ts` ensureIndexes collection/createIndexes va insert-only SaaS defaults; drop/syncIndexes yo‘q. Billing, davomat, membership, trial va idempotency unique indekslar, Telegram TTL/partial/sparse indekslar mavjud. | Productiondagi haqiqiy indekslar va yirik DBda qurilish vaqti noma’lum. Startup index yaratishi backupdan indeks tiklanganini isbotlamaydi. |
| Moliya | Charge/payment/reversal/adjustment, payroll/payout/reversal/audit; SaaS plan/subscription/payment request/SaasAudit/TrialGrant. Debt ledgerdan hosil bo‘ladi, alohida debt kolleksiya yo‘q. Subscription kelishilgan snapshotni saqlaydi. | Backupdan keyingi valid to‘lovlar va tashqi bank holatini reconciliation qilish operator vazifasi. |
| Tenant/auth | DBdan qayta tekshiriladigan user/role/active/sessionVersion, server tenant scope va teacher cheklovlari. 6.4.1 himoyalari saqlandi. | Jonli auth/tenant smoke va restore qilingan eski sessiya/tokenlarni boshqarish rejasi kerak. |
| Render | Blueprint build/start va `/api/ready`; tarixiy branch/plan/demo qiymatlari. API va frontend bir xizmatda. | Dashboarddagi source SHA, plan, instance, rollback artifact, auto-deploy va preview holati noma’lum. |
| GitHub Actions | PR/main CI: npm ci, typecheck, test, build, ikkala audit; read-only repo permission, deploy qadami yo‘q. | Required checks/branch protection tashqi sozlama; remote CI natijasi bu lokal hisobot bilan teng emas. |
| Startup/shutdown | Replica-set/index xatosida fail closed; production frontend build talabi; SIGTERM/SIGINT guard, HTTP drain/DB disconnect, 10s limit, xatoda exit 1. | Notification batch drain 6.4.1 dagidek cheklangan, UNKNOWN_OUTCOME reconciliation kerak. |
| Oldingi hujjat | 6.4.1 backup/restore tavsiyasi va 6.3.2 migration oldidan backup eslatmasi bor. | Tasdiqlangan backup policy, RPO/RTO dalili, to‘liq incident/restore/rollback runbooklari yo‘q edi. |

6.4.1 error privacy/shutdown tuzatishlari takrorlanmadi. App connection/auth,
SaaS/CRM va deployment konfiguratsiyasi o‘zgartirilmadi.

## Natija va operator hujjatlari

- [Backup siyosati va xarajat modellari](runbooks/backup-policy.md): Atlas snapshot,
  mos tierda PITR, faqat alohida ruxsatli encrypted logical fallback, IAM/KMS,
  retention/storage separation va tekshirish tartibi.
- [Database restore](runbooks/database-restore.md): lokal buyruq, guardlar,
  isolated restore, reconciliation va cutoverdan oldingi stop shartlari.
- [Incident javobi](runbooks/incident-response.md): DB uzilishi, o‘chirish, bad
  deploy, migration, backup buzilishi va infrastruktura access yo‘qolishi.
- [Render release/rollback](runbooks/render-rollback.md): insoniy approval,
  CI/main SHA, compatibility/backup gate, readiness/smoke va rollback qarori.

**Render kod rollbacki MongoDBni avtomatik tiklamaydi.** Yangi valid data ustiga
eski backup yozish ruxsat etilmagan. Production restore vositasi berilmadi;
yangi helper faqat test katalogida, deploy buildiga kirmaydi.

## Recovery maqsadlari

Pilot **RPO 24 soat, RTO 4 soat — unverified**. Maksimal rejalashtirilgan yo‘qotish
24 soatlik yozuv, maksimal tiklash hodisa aniqlanishidan tekshirilib qayta
ishga tushirilguncha 4 soat. Kunlik completed backup minimum; kechikish/xato
uchun 12 soatlik intervalni baholash kerak. Aniqroq RPO PITR yoki tezroq izchil
backup, lag alerti va xarajat talab qiladi. Actual RPO = incident va eng yangi
isbotlangan recovery point farqi; actual RTO provisioning, access, tasdiqlar,
restore, reconciliation va smoke vaqtlarini ham o‘z ichiga oladi.

## Sintetik restore dalili

2026-11-06, MongoDB 7.0.24, bir node disposable MongoMemoryReplSet;
MongoDB Database Tools 100.14.0. Native mongodump archive → AES-256-GCM fayl →
authenticated decrypt → mongorestore, alohida bo‘sh DB. Production URI qabul
qilinmaydi; target aniq tasodifiy non-production nom, loopback va alohida tasdiq.
Dry-run default, `--drop` yo‘q, bo‘sh bo‘lmagan target rad etiladi.

| Tekshiruv | Natija |
| --- | --- |
| `npm run test:recovery` | PASS: 1 fayl, 3 test |
| Kolleksiya/count/BSON | 45 kolleksiya; har birining count va to‘liq tartiblangan hujjat inventari teng |
| Indeks | Startupdan oldin barcha index nom/key tartibi/unique/partial/sparse/TTL options teng |
| Fixturelar | 2 tenant, 4 user (owner A/B, admin, teacher), 2 student, group/membership, classroom/schedule, attendance/session, charge/payment, hosila debt, plan/subscription/request/audit, onboarding, Telegram integration/delivery |
| Moliya | 1000 charge, 400 payment, API remainingAmount 600; boshqa tenant qarzi 0; subscription agreed price snapshot saqlangan |
| Auth/isolation | 4 parol login, anonymous 401, cross-tenant student 404, teacher finance 403, owner platform 403, admin read va teacher roster 200 |
| Startup | Connect/replica-set/index/readiness; alohida haqiqiy server.ts processi minimal test env bilan start, readiness 200 va SIGTERM exit 0 |
| Outbound | Bot/webhook/scheduler secret yo‘q, tashqi process/job yo‘q, parent fetch fail closed va chaqirilmagan; Telegram fixture disabled/cancelled |
| Salbiy holat | Noto‘g‘ri target/host/URI/tasdiq, wrong key/corrupt ciphertext, corrupt restoreda bo‘sh target saqlanishi va nonempty target rad etilishi |
| O‘lchangan recovery | **4265 ms (4,265 soniya)** — preflight/corruption tekshiruvlaridan restore, data/index/API tekshiruvi va haqiqiy process start/stop yakunigacha |
| Butun focused test bajarilishi | 7,77 soniya; Vitest hisoboti, import/fixture va cleanup ham kiradi |

Dastlabki urinishlar Mongoose auto-create sabab bo‘sh target tekshiruvini va index
ro‘yxatining tartib farqini aniqladi. Testda auto-create o‘chirildi; indekslar nom
bo‘yicha taqqoslanadi, compound key tartibi alohida saqlanadi. Ishlab turgan
ilova sozlamasi o‘zgarmadi. Yakuniy dalil yuqoridagi muvaffaqiyatli run.

Bu kichik quiescent fixture mashqi: concurrent write/oplog/PITR, sharded yoki
ko‘p node failover, real hajm, cloud provisioning, KMS/account recovery va real
production restore sinovi emas. Payroll/reversal/import/lead kolleksiyalari
bo‘sh holda inventarda; ularning barcha biznes holatlari bu drillda namunalangan
emas. Mavjud biznes testlari ularni qoplaydi, production recovery dalili o‘rnini bosmaydi.

## Majburiy tekshiruvlar

Yakuniy test natijalari quyida qayd etiladi. Dependency audit registry holatining
vaqtga bog‘liq tekshiruvi, kelajak kafolati emas. Builddagi mavjud >500 kB chunk
va dynamic/static import ogohlantirishlari bu fazaga aloqasiz.

| Buyruq | Natija |
| --- | --- |
| `npm test` | PASS: API 28 fayl, 405 passed / 1 opt-in drill skipped; web 19 fayl, 100 passed; jami 505 passed |
| `npm run test:recovery` | PASS: 3/3; skipped drill alohida haqiqatan bajarildi |
| `npm run typecheck` | PASS |
| `npm run build` | PASS; mavjud Vite ogohlantirishlari |
| `npm audit --audit-level=high` | PASS: 0 vulnerabilities |
| `npm audit --omit=dev --audit-level=high` | PASS: 0 vulnerabilities |
| `git diff --check` | PASS |

Dastlab dependency yo‘qligida typecheck `tsc: not found` bilan to‘xtadi. `npm ci`
standart read-only kesh bilan ishlamadi; `/tmp` keshi va muhit proxy orqali
lockfile o‘zgartirmasdan muvaffaqiyatli o‘rnatildi. Yuqoridagi natijalar undan
keyingi tekshiruvlar. Yangi runtime/dev dependency qo‘shilmadi.

## Qolgan majburiy operator ishlari

- [ ] Haqiqiy Atlas tier/backup/retention/PITR/restorable timestamp/IAM/KMSni tekshirish.
- [ ] A/B/C tanlovi, budjet, storage separation, monitoring, recovery owner va retentionni tasdiqlash.
- [ ] Alohida ruxsat bilan real backup siyosatini yoqish; job failure/staleness alerti.
- [ ] Ruxsatli, izolyatsiyalangan real backup restore verifikatsiyasi va representative hajmda actual RPO/RTO.
- [ ] Render Dashboard, deployed/main SHA, rollback imkoniyati, required CI va branch protectionni tasdiqlash.
- [ ] Break-glass MFA/ikkinchi operator va secret/KMS access recovery mashqi.

Bu amallar bajarilmaguncha **6.4.2 production-ready deb belgilanmaydi**.
Haqiqiy production backup va recovery rejasi hali qo‘lda operator sozlashini
hamda ruxsatli isolated restore tekshiruvini talab qiladi.

6.4.3 keyingi qadamlar: MFA va password recovery/change dizayni, operator
credential rotation, trafikdan kelib chiqqan proxy/rate-limit siyosati.
Legacy tenant migrationi alohida business tasdig‘i bilan; notification bounded
drain/worker ishonchliligi 6.4.4 doirasida qoladi.
