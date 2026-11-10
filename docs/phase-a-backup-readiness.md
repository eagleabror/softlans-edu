# Phase A — backup va production xavfsizligi

2026-11-10. Branch: `feat/phase-a-backup-readiness`. Asos:
`ed3156b3b2f20cd2d207c12df92e7d6b17c98e59`.
[A–F GAP auditi](automation-gap-analysis.md) kod, test va GitHub CI dalillariga
asoslangan; PR #44 merge holati tekshirildi. Faqat Phase A bajarildi.

## Minimal o‘zgarish

Mavjud `recovery.test.ts`/`helpers/recovery.ts`, backup policy, restore va incident
runbooklari qayta ishlatildi. Yangi production backup mexanizmi yoki API/UI
qo‘shilmadi: sintetik drill development/CI operatsiyasi, CRM sahifasi emas.

- `npm run test:recovery` runner’i faqat o‘zi yaratilgan lokal fixture drillini
  ishga tushiradi. Test processiga ilova credentiallari/DB URI/NODE_OPTIONS
  berilmaydi, operator CLI argumentlari qabul qilinmaydi.
- Har run yangi report/temp katalogi oladi. Uchta majburiy testning hammasi
  passed va process exit 0 bo‘lgandagina PASS. Skipped, missing, duplicate,
  buzilgan JSON, runner yoki tool xatosi failed bo‘ladi.
- JSON/Markdown artifact faqat fixed check/status/code, UTC start/finish va
  davomiyliklardan iborat. Raw Vitest diagnostics ko‘chirilmaydi; vaqtinchalik
  JSON o‘chiriladi. `productionVerified`, `rpoVerified`, `rtoVerified` doim false.
- CI alohida `Sintetik MongoDB backup va restore` jobini har PR/main tekshiruvida
  bajaradi. MongoDB Tools 100.20.1 rasmiy manifest SHA256 bilan pin qilingan;
  hech qanday secret, production DB, deploy yoki scheduled production job kerak emas.
  Download qadami xatosida ham dependency o‘rnatilgan bo‘lsa runner missing-tools
  hisobotini yaratishga urinadi; workflow oldingi xatoni saqlaydi.
- CI summary va 14 kunlik artifact faqat `report.json`/`report.md`ni oladi,
  encrypted dump yoki BSONni olmaydi. Bu hisobot retentioni, production backup
  retention siyosati emas.
- Native testga parallel backup fayl yaratishda bitta muvaffaqiyat/bitta rad
  etish va wrong-key restore oldidan DB bo‘sh qolishi qo‘shildi. Mavjud corrupt
  ciphertext, takroriy restore, RBAC va tenant isolation testlari saqlandi.
- [Readiness reyestri](runbooks/backup-readiness.md) live backup, offsite,
  retention, encryption, IAM/KMS, restore va RPO/RTO dalillarini ajratadi.
  README’dagi eskirgan tashqi TEST_MONGODB_URI ko‘rsatmasi haqiqiy test isolation
  kodi bilan moslashtirildi.

## Tekshiruv natijalari

Lokal muhit: Node 24.19.0, npm 11.9.0 (CI Node 22), MongoDB 7.0.24,
Tools 100.20.1. Dependency’lar lockfile’dan o‘rnatildi; lockfile o‘zgarmadi.

| Tekshiruv | Natija |
| --- | --- |
| `npm test` | PASS: API 596, web 138, contracts 1 — jami 735 passed. Avvaldan opt-in native drill shu buyruqda 1 skipped, quyidagi alohida buyruqda amalda bajarilgan. |
| `npm run test:recovery` | PASS 3/3; 56 kolleksiya, BSON va barcha indekslar startupdan oldin teng; moliya, cash/payroll, readiness, login, tenant/RBAC, corrupt/wrong-key/replay va parallel backup tekshirildi. |
| Report unit testlari | 4/4 (npm test tarkibida): to‘liq/yo‘q/skipped/duplicate/failed natija, nonzero exit, tool/runner failure, diagnostics maxfiyligi va yaroqsiz duration. |
| Vositasiz runner sinovi | Kutilgan exit 1, `DATABASE_TOOLS_MISSING`, hamma tekshiruv unverified; meros DB URI/token report yoki stdoutga chiqmagan. |
| `npm run typecheck` | PASS, barcha workspace’lar. |
| Yangi test/runner fayllari uchun strict `tsc --noEmit` | PASS; asosiy typecheck test katalogini qamramagani uchun alohida tekshirildi. |
| `npm run build` | PASS; mavjud Vite dynamic/static import va >500 kB chunk ogohlantirishlari. |
| `npm audit --audit-level=high` | PASS, 0 vulnerabilities. |
| `npm audit --omit=dev --audit-level=high` | PASS, 0 vulnerabilities. |
| `git diff --check` | PASS. |

Yakuniy cached drill: 7,764 ms jami runner, native test 6,255 ms; bu
cloud provisioning yoki production RTO emas. Birinchi run binary yuklash bilan
59,982 ms bo‘lgan; logdagi kichik restore/API segmenti 5,069 ms. Success va
sun’iy missing-tools failure hisobotlari alohida `work/recovery/run-*` kataloglarda.
Remote PR CI natijasini PR Checks’da tekshiring; main’ning oldingi yashil CI’si
yangi branch o‘zgartirishlarining remote tasdig‘i sifatida ko‘rsatilmaydi.

## Qolgan cheklovlar va keyingi bosqich gate’i

**Production-ready emas.** Atlas/Render live sozlamalari yoki mijoz ma’lumoti
o‘qilmadi/o‘zgartirilmadi. Production backup/real restore, deploy, scheduler
faollashtirish, xabar yoki pul operatsiyasi bajarilmadi. Main’ga push va PR
merge qilinmaydi. B–F business kodi o‘zgarmadi; manual billing/payroll saqlandi.

Drill kichik, yozuvchisiz, disposable single-node replica set bilan cheklangan;
oplog/PITR, production hajmi, cloud/storage/KMS/account recovery, parallel
production writer consistency yoki real pul/provider reconciliation isboti emas.
Archive helper 16 MiB bilan cheklangan va production vositasi sifatida yaramaydi.
Bir restore target’iga parallel yozuvchilar ruxsat etilmaydi; bu drill shu
target’ga parallel restore xavfsizligi haqida da’vo qilmaydi.

Keyingi bosqich uchun owner va DB mas’uli readiness reyestrini dalillar bilan
to‘ldirib, offsite/encryption/retention/access recovery va representative restore
natijasini tasdiqlashi kerak. Pilot taklif: **RPO ≤24 soat, RTO ≤4 soat**;
bu biznes roziligisiz SLA emas. Production backup yoki real restore uchun
alohida rozilik olinadi. Phase B faqat keyingi topshiriqda, alohida branch/PR’da;
secret/config noma’lum bo‘lsa scheduler himoyasi chetlab o‘tilmaydi.
