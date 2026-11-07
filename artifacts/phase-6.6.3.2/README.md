# Phase 6.6.3.2 — tekshiruv dalillari

Barcha MongoDB tekshiruvlari faqat har ishga tushishda yaratiladigan disposable lokal replica setda bajarildi. Production URI o‘qilmagan. Brauzer sinovi real API va production frontend build bilan ishlaydi; Playwright /usr/bin/chromium ishlatadi. Ma’lumotlar faqat sintetik.

## Tekshiruvlar

- [To‘liq testlar](full-tests.txt): barcha API va UI suite’lari; mavjud recovery drill shartli skipi logda ko‘rsatiladi.
- [Yangi moliyaviy testlar](management-tests.txt): 22 ta integratsion/money test.
- [Yangi UI va mavjud expense tekshiruvlari](ui-tests.txt): 10 ta interaction test.
- [Typecheck](typecheck.txt), [build](build.txt).
- [To‘liq npm audit](audit.json), [production dependency audit](audit-production.json): 0 zaiflik.
- [Brauzer tekshiruvi](browser.txt), [screenshot manifest](screenshot-manifest.json): JS xatolari yo‘q.

10 viewport: 320, 375, 390, 699, 700, 701, 768, 900, 1024, 1440px. Sahifa gorizontal chiqib ketmaydi; zich moliyaviy jadvallar ichki scroll bilan barcha ustunlarni saqlaydi. Sana filtrlari, qayd chegarasi, CSV download va grafik detail jadvali real API bilan tekshirilgan. Desktop va mobile rasmlar vizual ko‘rib chiqilgan.

| Holat | Desktop | Mobile |
| --- | --- | --- |
| Boshqaruv dashboardi | [Rasm](desktop/management.png) | [Rasm](mobile/management.png) |
| O‘tgan oy filtri | [Rasm](desktop/previous-month.png) | [Rasm](mobile/previous-month.png) |
| Tarixiy qayd chegarasi | [Rasm](desktop/historical-cutoff.png) | [Rasm](mobile/historical-cutoff.png) |
| Kelgusi xarajatlar tasnifi | [Rasm](desktop/classification.png) | [Rasm](mobile/classification.png) |

Tarixiy cutoff rasmida sintetik source/accounts cutoffdan keyin yaratilgani sababli oldingi tarixga sun’iy ko‘chirilmaydi; bo‘sh manbalar va to‘liqlik ogohlantirishlari ko‘rsatiladi. Hozirgi hisobdan eski hisob yaratish yoki backfill qilinmaydi.

Qayta ishlatish: `npm ci`, `npm ci --prefix scripts/redesign`, `npm run build`, `node_modules/.bin/tsx scripts/profit-loss-screenshots.ts`. Test muhiti lokal portlar ochishga ruxsat berishi kerak. Skript yangi lokal MongoDB yaratadi, browser/context/server/DBni yakunda yopadi.

Buildning avvaldan mavjud 500 kBdan katta bundle va FinancialReports static/dynamic import ogohlantirishlari saqlanadi. Recovery drill oddiy testda shartli skip qilinadi; uning o‘tganligi da’vo qilinmaydi. Merge/deploy bajarilmagan.
