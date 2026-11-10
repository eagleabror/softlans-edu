# Phase C — Automatic Teacher Payroll

## Boshlang‘ich GAP tahlili

Asos: main `84ec2465c85d772da3d9e7632b4c6effd5e5835b`.
PR #46 2026-11-10 16:41:23 UTC da merge qilingan. Ushbu ish uni merge qilmagan.

| Modul | Mavjud | Phase C bo‘shlig‘i |
| --- | --- | --- |
| payroll-calculation.ts | fixed/collected/billed, guruh override, reversal, rounding, immutable basis | Yo‘qolgan guruh va buzilgan summalar uchun aniq exception; formulani saqlash |
| payroll-automation.ts | Toshkent oy yopilishi, cursor, faol teacher, tenant lock + unique key, exception retry | Yozuvsiz batch preview, durable attempt tarixi, infrastructure failure/interruption ko‘rinishi |
| payroll-scheduler.ts | alohida Bearer secret, input validation, rate limit | Default-off write gate, authenticated dry-run |
| PayrollAutomation.tsx | Owner-only ota panel, oylik natija, exception, detail/basis link, manual fallback | Preview, urinishlar tarixi, navbat va delivery farqi |
| payroll-monthly.yml / CLI | retry/cursor, faqat draft | main + explicit enable gate, default dry-run, CLI secret/enable gate DB ulanishidan oldin |
| payroll /preview | mavjud hisoblashni preview qiladi | Tenant billingRevision yozadi; uni read-only snapshot qilish |

Production backup tayyorligi hali tasdiqlanmagan. Bu Phase C doirasida backupni tasdiqlamaydi.

## Tayyorlangan xatti-harakat

- Hisoblash formulasi, rounding, collected/billed manbalari, fixed qoidasi va qo‘lda individual qoralama yaratish saqlanadi. Faqat yo‘qolgan guruh (`PAYROLL_GROUP_MISSING`) va buzilgan summa (`PAYROLL_CALCULATION_DATA_INVALID`) uchun validation qo‘shildi. Foizli qoida uchun hisoblash guruhi bo‘lmasa aniq exception qaytariladi. Mavjud guruhdagi haqiqatan nol tushum/hisob nol asos bo‘lishi mumkin; bu taxminiy xato sifatida o‘zgartirilmaydi.
- Owner `POST /api/payroll/automation/preview` orqali 10 o‘qituvchilik snapshot preview oladi (`month`, ixtiyoriy `afterTeacher`). Mavjud statement’ning muzlatilgan asosi va tuzatishlardan keyingi summasi ko‘rsatiladi. Yangi qoralama qayta hisoblanadi; preview quote emas.
- Individual `/api/payroll/preview` endi billing lock/revision yozmaydi. Preview’lar maosh, audit, attempt yoki notification yaratmaydi.
- `GET /api/payroll/automation/status?month=YYYY-MM&page=1&historyPage=1`: oylik teacher natijalari, alohida 20 qatorli attempt tarixi, notification outbox status sonlari. Tarix faqat tenant Owner’iga ochiq. Admin, teacher va super_admin boshqara olmaydi.
- Har haqiqiy batch urinishiga `PayrollAttempt` yoziladi: source, boshlanish/yakun vaqti, cursor, status, yakuniy counters yoki fixed-code failure. Raw error/URI/secret saqlanmaydi. Tarix ombori ishlamasa batch yozishdan oldin to‘xtaydi; individual manual draft unga bog‘liq emas.
- Har teacher qoralamasi va uning audit/item’i bitta tranzaksiyada; umumiy tenant lock va unique `(tenantId, teacherId, payrollMonth)` scheduler/manual hisobni seriallashtiradi. Summalar, adjustments, approvals va oldingi payouts replay’da o‘zgarmaydi. Readiness outbox ham unique key bilan mavjud consent siyosatidan foydalanadi. `pending`/`sending` yetkazib berildi degani emas; panel buni ochiq aytadi. `sent` notification tizimining yuborish holati, odam o‘qiganligi tasdig‘i emas.
- HTTP scheduler body’sida `dryRun` default **true**. Bearer `PAYROLL_SCHEDULER_SECRET` har doim zarur. Yozish uchun API’da `PAYROLL_SCHEDULER_ENABLED=true` ham talab qilinadi. Direct scheduler service ham ushbu gate’ni tekshiradi.
- CLI’da `PAYROLL_DRY_RUN` default **true**. Secret va enable gate DB ulanishidan oldin tekshiriladi. Dry-run `ensureIndexes` hamda Mongoose `autoCreate`’ni ishlatmaydi; bo‘sh sintetik bazada kolleksiya/indeks ham yaratmasligi integration test bilan tekshiriladi.
- GitHub workflow faqat main + `vars.PAYROLL_SCHEDULER_ENABLED == 'true'` + URL bo‘lganda ishlashi mumkin. Manual dispatch default dry-run; scheduled invocation faqat shu explicit opt-in bilan write so‘raydi. Transport/503 retry, month pin, cursor loop va dry-run acknowledgement tekshiriladi.

## Cheklov va recovery semantikasi

Teacher bo‘yicha commit qilingan qoralamalar keyingi teacher yoki batch completion xatosidan keyin ham saqlanadi. Retry shu oyni boshidan yoki tasdiqlangan cursor’dan qayta ishlaydi va mavjudlarini saqlaydi. Tarixdagi counters butun oy emas, aynan 10 teacher’gacha bo‘lgan batch natijasidir. Frozen completed scheduler oyi qayta hisoblanmaydi; qo‘lda fallback saqlanadi.

Jarayon o‘ldirilsa yoki DB xato yozuvini ham saqlay olmasa attempt `running` qolishi mumkin. Bu yakun tasdiqlanmagan holat sifatida ko‘rsatiladi; avtomatik ravishda completed deb belgilanmaydi. `failed` bo‘lishi hech qanday qoralama commit bo‘lmaganligini anglatmaydi. Natijani tekshirish va xavfsiz replay talab qilinadi. Retry yangi attempt yaratadi, avvalgi urinish tarixi saqlanadi. History completion yozuvi teacher tranzaksiyalaridan alohida: acknowledgement xatosi muvaffaqiyat sifatida qaytarilmaydi.

DB hajmi uchun mavjud 20 000 payment/charge limiti saqlangan. Katta tenant’lar 10 teacher batch’larda ishlanadi; har preview page o‘z snapshot’iga ega. Production’da tarix retention/archival siyosati keyinchalik alohida belgilanishi kerak.

## Production holati

**Kod tayyor; production faollashtirilmagan.** Ushbu ish scheduler’ni yoqmaydi, GitHub secrets/variables yoki Render environment’ni o‘zgartirmaydi. Production MongoDB’ga yozuv, haqiqiy xabar/pul, auto-approve, auto-payout, bank integratsiyasi, main’ga push, deploy yoki merge bajarilmaydi. Production backup tasdiqlanmagan. Phase D boshlanmagan.


## Lokal tekshiruv natijalari

- `npm test`: API, web va contracts suite’lari tekshirildi; yakuniy commit bo‘yicha aniq test sonlari Draft PR tavsifida. Mavjud opt-in recovery testi oddiy suite’da skipped; bu production backup tasdig‘i emas.
- `npm run typecheck`, o‘zgargan payroll/workflow testlari uchun alohida strict TypeScript: PASS.
- `npm run build`: PASS; mavjud Vite chunk/import ogohlantirishlari saqlangan.
- `npm audit --audit-level=high`, `npm audit --omit=dev --audit-level=high`: 0 vulnerabilities.
- CI xavfsizlik testlari: Python 11/11, Node 6/6 PASS; `git diff --check`: PASS.
- Sintetik MongoDB: yozuvsiz snapshot va CLI (kolleksiya/indeks ham yaratmaslik), tenant/RBAC, exact Tashkent boundary, partial failure, transient rollback/retry, interrupted/unknown attempt, acknowledgement failure, attempt-store unavailable, history/teacher pagination, manual/scheduler concurrency va pending outbox tekshirildi.
- Chromium + faqat sintetik API: 10 viewport (320–1440 px), page overflow/page error yo‘q; keyboard preview, uzun ism/katta summa, mobile/desktop tekshirildi. Internal scheduler, draft generation yoki real tarmoq xabari chaqirilmadi.

GitHub CI natijalari Draft PR tavsifida qayd etiladi.
