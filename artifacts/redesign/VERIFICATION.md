# Tekshiruv natijalari

- `npm test`: API — 26 fayl, 398 test; frontend — 19 fayl, 100 test. Barchasi o‘tdi.
- `npm run typecheck`: o‘tdi.
- `npm run build`: o‘tdi. Vite 500 kB dan katta JavaScript chunk haqida ogohlantirish berdi.
- `npm audit --audit-level=high`: 0 zaiflik.
- `npm audit --omit=dev --audit-level=high`: 0 zaiflik.
- `git diff --check`: o‘tdi.
- Chromium: 14 ta funksional smoke tekshiruvi o‘tdi.
- 120 route/rol kombinatsiyasi, 140 ekran holati va 280 skrinshot. Yetishmayotgan skrinshot: 0. Kutilmagan konsol xatosi: 0. Sahifa overflow: 0.
- Desktop 1440×900, mobile 390×844; qo‘shimcha responsive smoke 1280, 1024, 768 va 320px’da bajarildi.
- PNG o‘lchamlari, barcha galereya havolalari va uchta ZIP yaxlitligi tekshirildi.

## Muhit va chegaralar

Barcha ma’lumotlar disposable MongoDB replica set’da sun’iy yaratildi. Production ma’lumotlari ishlatilmadi. Xato holati uchun 503 javobi ataylab kiritildi va manifestda `expectedErrors` sifatida ajratildi. Real Telegram xabari yoki bank o‘tkazmasi yuborilmadi; mavjud integratsiya testlari va lokal API ishlatildi. Pixel-perfect yoki WCAG sertifikati da’vo qilinmaydi.

Batafsil natijalar: `verification-results.json`, `smoke-results.json`, `test-results/`.
