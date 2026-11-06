# Phase 6.6.2 — tekshiruv dalillari

Tekshiruvlar faqat lokal, vaqtinchalik MongoDB replica set va sintetik ma’lumotlar
bilan bajarildi. Production mijoz ma’lumotlari o‘qilmadi. Merge, deploy, maoshni
avtomatik tasdiqlash va pul o‘tkazish bajarilmadi.

| Tekshiruv | Haqiqiy natija |
| --- | --- |
| `npm test` — API | 34 fayl: **514 ta o‘tdi, 1 ta skip** |
| `npm test` — web | 23 fayl: **126 ta o‘tdi** |
| Payroll UI qayta tekshiruvi | 2 fayl: **13 ta o‘tdi** |
| `npm run typecheck` | API va web — o‘tdi |
| `npm run build` | API va web — o‘tdi |
| `npm audit --json` | **0 ta zaiflik** |
| `npm audit --omit=dev --json` | **0 ta zaiflik** |
| Haqiqiy brauzer tekshiruvi | 6 ta screenshot; JS xatosi yo‘q |
| Responsive tekshiruv | 320, 375, 390, 600, 601, 700, 701, 768, 1024, 1440px — sahifa overflow’i yo‘q |

To‘liq suite’da mavjud native backup/restore DR testi `DR_DRILL_CONFIRM=synthetic-only`
opt-in sharti sabab skip qilindi; u o‘tdi deb hisoblanmadi. Build muvaffaqiyatli,
lekin Vite mavjud katta JS chunk va `FinancialReports` importlari bo‘yicha
ogohlantirish berdi. Bu payroll funksiyasi uchun bloklovchi xato emas.

Payroll testlari: Tashkent oy/yil chegaralari, kabisa fevral, yopilish vaqti,
prorated `finalAmount`, kechikkan tushum, reversallar, guruh override’lari,
belgilangan oylik, yetishmagan/noto‘g‘ri qoidalar, parallel scheduler va qo‘lda
so‘rovlar, saqlangan cursor bilan davom etish, mavjud tuzatishlar/approved payroll
va payout tarixini saqlash, RBAC, MFA, CSRF va tenant izolyatsiyasi.
Bildirishnoma testlari rozilik, deduplikatsiya, tinch vaqt va ulanish uzilishini
tekshiradi. UI testlari tayyorlik, xatodan qayta urinish va noaniq/accepted
javobni yakuniy muvaffaqiyat deb qabul qilmaslikni tekshiradi.

Buyruq chiqishlari: [tests.txt](tests.txt), [payroll-tests.txt](payroll-tests.txt), [payroll-ui-tests.txt](payroll-ui-tests.txt),
[typecheck.txt](typecheck.txt), [build.txt](build.txt),
[security-audit.json](security-audit.json),
[security-audit-production.json](security-audit-production.json).

Screenshotlar real API va build qilingan frontenddan olindi. Faqat sintetik
markaz, o‘qituvchilar, guruhlar va summalar ishlatildi. Caption va keng jadvallar
kichik ekranda o‘z konteyneri ichida scroll qilinadi; moliyaviy ustunlar yashirilmaydi.
Klaviatura fokusi va qo‘lda batch replay tekshirildi. Capture yakunida barcha
payrolllar qoralama, SalaryPayout soni nol ekanligi tekshirildi.

| Holat | Desktop | Mobil |
| --- | --- | --- |
| Qoida yetishmayapti | [exceptions](desktop/exceptions.png) | [exceptions](mobile/exceptions.png) |
| Qoralamalar tayyor | [ready](desktop/ready.png) | [ready](mobile/ready.png) |
| Guruhlar va tuzatishlar bo‘yicha review | [review](desktop/review.png) | [review](mobile/review.png) |

[screenshot-manifest.json](screenshot-manifest.json) capture vaqti, kengliklar va
assertionlarni saqlaydi. Qayta olish: `npm run build`, so‘ng
`npx tsx scripts/phase-6.6.2-capture.mts` (avval `scripts/redesign` lockfile’i bo‘yicha
Playwright/Chromium o‘rnatilgan bo‘lishi kerak).

Yopilish siyosati, scheduler protokoli va qo‘lda fallback:
[docs/phase-6.6.2-automated-payroll.md](../../docs/phase-6.6.2-automated-payroll.md).
