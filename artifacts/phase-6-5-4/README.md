# Phase 6.5.4 tekshiruv dalillari

Baza: main `872fd4e0930dfdf573ae20b2cc9a0d35836541a0`, tekshiruv sanasi
2026-11-09. Barcha moliyaviy yozuvlar yangi vaqtinchalik MongoDB replica setlarda,
faqat sintetik ma’lumotlarda bajarildi. Production manzillari chaqirilmadi.

Yakuniy `npm test`: **718 passed, 1 skipped**, exit 0. API 40 fayl / 580 passed,
1 gated skipped; web 25 fayl / 138 passed. Typecheck va build exit 0. Ikkala audit
exit 0, 0 zaiflik. Secretsiz billing va payroll acceptance: **PASS**.

## Acceptance qamrovi

| Talab | Dalil |
| --- | --- |
| Student yaratish va enrollment | `manual-financial-mode.test.ts`: admin yaratadi va billing preview bilan guruhga qo‘shadi |
| Birinchi oy proratsiyasi | 300000 UZS, 13 darsdan 7 dars, yakuniy 161538 UZS |
| Keyingi oy billing | Administrator orqali 2026-11: 1 yaratildi; keyingi owner retry: 0/1 |
| Dublikat va tarix himoyasi | Oldingi, qisman/to‘liq to‘langan va bekor qilingan hisoblar nusxasi o‘zgarmaydi |
| Qisman to‘lov va qarz | 100000 to‘lovdan keyin jami 361538; birinchi oy yopilgach 300000; keyingi hisob bekor qilingach 0 |
| Secretsiz payroll draft | Owner orqali 3 draft, 1 qoida istisnosi; retry 0 yangi, 3 saqlangan |
| Maosh turlari | Manual fixture: billed proratsiya 64615, fixed 500000, yig‘imi yo‘q collected 0; mavjud billing/payroll testlarida haqiqiy collected, reversals va override chegaralari |
| Qoidasi yo‘q ustoz | `NO_SALARY_RULE`, statusda operatorga ko‘rinadi, sun’iy payroll yozilmaydi |
| Approve va payout ajratilishi | Draft payout 409; approve o‘zi payout yaratmaydi; alohida payout 201 |
| Payroll immutable retry | Tuzatish, approve, payoutdan keyin butun payroll nusxasi va bir martalik audit saqlanadi |
| Admin/owner/teacher | Admin billingga ruxsatli; admin/teacher payroll automationga 403 |
| Tenant isolation | Boshqa markaz hisob/payroll detail 404, status bo‘sh; generation o‘z markazida |
| MFA/session/CSRF | Origin yo‘q 403; MFA yoqilgach oddiy sessiya 401; MFA session ishlaydi; revoke 401; to‘liq MFA suite ham bajarilgan |
| Secret yo‘q schedulerlar | Uchta internal route cookie yoki begona Bearer bilan ham 503/SCHEDULER_DISABLED |
| Secret bor schedulerlar | Mavjud billing/payroll/notification testlari Bearer, query/cookie bypass rad etilishini tekshiradi |
| Qo‘lda UI | Haqiqiy local API bilan majburiy checkbox va desktop/mobile counts; `browser-check.json` |

## Natija fayllari

- `manual-acceptance.txt`: yangi secretsiz acceptance va sanasi mahkamlangan pilot testi.
- `billing-ui-tests.txt`: billing UI 6 test.
- `full-tests.txt`: yakuniy barcha workspace testlari.
- `typecheck.txt`, `build.txt`: yakuniy tekshiruvlar; builddagi >500 kB chunk ogohlantirishi mavjud.
- `audit.json`, `audit-production.json`: ikkala auditda 0 zaiflik.
- `billing-confirmation-*` va `billing-result-*`: desktop/mobile sintetik screenshotlar.

Dastlabki to‘liq testda mavjud pilot fixture sanaga bog‘liq yiqildi: qaytarishlar
2026-11-09 sanasiga yozilib, 2026-11-07 gacha hisobotdan tashqarida qoldi.
`pilot-financial-lifecycle.test.ts`da faqat Date 2026-11-07ga mahkamlandi;
real timerlar ishlashda qoladi, mahsulot moliyaviy hisobi o‘zgarmadi.
Keyingi targeted tekshiruv ikkala acceptance testini o‘tkazdi.

Default sandboxda MongoDB port bind `EPERM` bergan; to‘liq va yakuniy acceptance
izolyatsiyalangan cloud executorning ruxsat etilgan loopback tarmog‘ida bajarildi.
Gated native recovery drill odatiy `npm test`da mavjud qoida bo‘yicha skipped;
`mongodump`/`mongorestore` bu muhitda o‘rnatilmagan. Production backup kechiktirilgan.

GitHub URL variable/secret metama’lumotlari 403; workflowlar active, oxirgi
ko‘rilgan 12 run skipped. Hech qanday URL, secret, workflow, deploy yoki production
ma’lumoti o‘zgartirilmagan. Batafsil cheklovlar operator hujjatida.

**Real mijoz moliyaviy piloti: NO-GO.**
