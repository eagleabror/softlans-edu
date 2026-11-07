# Phase 6.6.3.1 — Tekshiruv dalillari

Barcha ma’lumotlar yangi lokal disposable MongoDB replica setida yaratilgan sintetik yozuvlardir. Production bazasi yoki foydalanuvchisi ishlatilmagan. Rasmlar mock API emas, haqiqiy API va built React interfeysidan olingan.

## Natijalar

- Yangi moliyaviy integratsion testlar: 18/18 — [cash-tests.txt](cash-tests.txt).
- Yakuniy barcha workspace testlari: API 532 passed + 1 skipped; UI 131 passed — jami 663 passed — [full-tests.txt](full-tests.txt).
- Typecheck: [typecheck.txt](typecheck.txt).
- Build: [build.txt](build.txt).
- Dependency security audit: [security-audit.json](security-audit.json), production: [security-audit-production.json](security-audit-production.json). Ikkalasida ham 0 ta zaiflik.
- Brauzer natijasi: [browser.txt](browser.txt), [screenshot-manifest.json](screenshot-manifest.json).

Oddiy to‘liq testdagi yagona shartli skip — mavjud native backup/restore DR drill; u `DR_DRILL_CONFIRM=synthetic-only` bilan alohida ishga tushiriladi. To‘liq test logi haqiqiy bajarilgan va skipped sonlarni ko‘rsatadi.

## Desktop va mobil

| Sahifa | Desktop 1440px | Mobile 390px |
| --- | --- | --- |
| Xarajatlar | [Rasm](desktop/expenses.png) | [Rasm](mobile/expenses.png) |
| Yangi xarajat | [Rasm](desktop/new.png) | [Rasm](mobile/new.png) |
| Kategoriyalar | [Rasm](desktop/categories.png) | [Rasm](mobile/categories.png) |
| Hisoblar | [Rasm](desktop/accounts.png) | [Rasm](mobile/accounts.png) |
| Pul harakatlari | [Rasm](desktop/movements.png) | [Rasm](mobile/movements.png) |
| Kunlik kassa | [Rasm](desktop/daily.png) | [Rasm](mobile/daily.png) |
| Xarajat tafsilotlari | [Rasm](desktop/detail.png) | [Rasm](mobile/detail.png) |
| Xavfsiz tasdiqlash | [Rasm](desktop/confirmation.png) | [Rasm](mobile/confirmation.png) |

Har sahifa 320, 375, 390, 699, 700, 701, 768, 900, 1024, 1440px kengliklarda sahifa bo‘ylab overflow yo‘qligiga tekshirilgan. Jadval ichidagi mahalliy scroll saqlangan. Native dialog fokusi va Escape, UI orqali haqiqiy void ham tekshirilgan. Brauzer JavaScript xatolari: 0.

## Qayta ishga tushirish

Repository rootdan, faqat lokal test muhiti bilan:

```sh
npm ci
npm test
npm run typecheck
npm run build
npm audit --json
npm audit --omit=dev --json
npm ci --prefix scripts/redesign
npx tsx scripts/phase-6.6.3.1-capture.mts
```

Screenshot skripti `/usr/bin/chromium`dan foydalanadi. MongoDB 7.0.24 binary va Chromium lokal mavjud bo‘lishi yoki test uchun o‘rnatilishi kerak. Skript hech qanday tashqi MONGODB_URI qabul qilmaydi, source to‘lovlari, bank xizmatlari yoki production endpointlarini chaqirmaydi.
