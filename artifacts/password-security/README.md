# Parol xavfsizligi — Playwright skrinshotlari

22 ta skrinshot haqiqiy lokal API, yangi disposable MongoDB replica set va test
pochta adapteri bilan olindi. Real provider yoki production ma’lumoti ishlatilmadi.
Email adreslari sun’iy, inputlarda parollar yashirilgan; tokenlar tasvirga kirmaydi.

Desktop: 1440×1000; mobile: 390×844; rasmlar to‘liq sahifani qamrab oladi.
320, 375, 390, 700, 701, 768, 1024 va 1440px reflow tekshirildi; gorizontal
page overflow va browser page error topilmadi. Form focus va visibility toggle
ham browserda tekshirildi. Bu avtomatik WCAG sertifikati emas.

| Holat | Desktop | Mobile |
| --- | --- | --- |
| Parolni o‘zgartirish | [PNG](desktop-change-password.png) | [PNG](mobile-change-password.png) |
| Change validatsiya | [PNG](desktop-change-validation.png) | [PNG](mobile-change-validation.png) |
| Change muvaffaqiyat | [PNG](desktop-change-success.png) | [PNG](mobile-change-success.png) |
| Parolni unutish | [PNG](desktop-forgot-password.png) | [PNG](mobile-forgot-password.png) |
| Email validatsiya | [PNG](desktop-forgot-validation.png) | [PNG](mobile-forgot-validation.png) |
| Umumiy so‘rov javobi | [PNG](desktop-forgot-requested.png) | [PNG](mobile-forgot-requested.png) |
| Provider yo‘q | [PNG](desktop-forgot-disabled.png) | [PNG](mobile-forgot-disabled.png) |
| Parolni tiklash | [PNG](desktop-reset-password.png) | [PNG](mobile-reset-password.png) |
| Reset validatsiya | [PNG](desktop-reset-validation.png) | [PNG](mobile-reset-validation.png) |
| Reset muvaffaqiyat | [PNG](desktop-reset-success.png) | [PNG](mobile-reset-success.png) |
| Ishlatilgan token xatosi | [PNG](desktop-reset-used-token.png) | [PNG](mobile-reset-used-token.png) |

[Manifest](manifest.json) · [Texnik hujjat](../../docs/phase-6-4-3-1-password-security.md)

Qayta olish (lokal Chromium kerak):

```sh
npm ci
npm ci --prefix scripts/redesign
npm run build
node_modules/.bin/tsx scripts/password-security-capture.mts
```

Harness 5173 va 5174 portlarini o‘zi ochadi, faqat yangi disposable bazani ishlatadi,
so‘ng server/baza/browserni yopadi. Vite yoki boshqa lokal server bu portlarda
ishlamasligi kerak. Provider delivery va production konfiguratsiya bu skrinshotlar
bilan tasdiqlanmaydi. GitHubda PNG havolasini ochib, raw/download orqali yuklab olish mumkin.
