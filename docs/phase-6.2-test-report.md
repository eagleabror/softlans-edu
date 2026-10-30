# Lead CRM — tekshiruv hisoboti

## Avtomatik tekshiruvlar

- To‘liq `npm test`: backend 345/345, frontend 66/66, jami **411/411**.
- Yakuniy qisman tahrirlash regressiyasi qo‘shilgach, CRM integratsion fayli yana
  tekshirildi: **21/21**. Faqat izohni tahrirlash telefonni saqlashi va bo‘sh PATCH
  rad etilishi ham shu testlarga kiritilgan.
- Yangi CRM frontend testlari: 7/7 (to‘liq frontend to‘plamiga kiradi).
- `npm run typecheck`: barcha workspace’lar tekshirildi.
- `npm run build`: API TypeScript va web production Vite build.
- `npm audit --json`: 0 zaiflik (critical/high/moderate/low: barchasi 0).
- `git diff --check`: whitespace xatolari yo‘q.

Testlar haqiqiy MongoDB 7.0.24 lokal replica set orqali bajarildi. Atlas yoki
production ma’lumotlar bazasiga ulanilmadi.

## Qamrov

Yaratish/tahrirlash/arxiv, telefon normalizatsiyasi, server qidiruvi, pagination,
filtrlar, mass assignment va noto‘g‘ri formatlar, status o‘tishlari, lost sababi,
audit va timestamp, administrator biriktirish, tenant isolation va IDOR,
Teacher/Super Admin taqiqi, JWT/CSRF, sinov yaratish/ko‘chirish/natija/bekor qilish,
haqiqiy jadval bilan kesishish, parallel sinovlar, follow-up filtrlari/bajarilishi,
konvertatsiya, parallel double conversion, mavjud Student bog‘lash, begona yoki
arxiv Student’ini rad etish, bo‘sh telefonli bir xil ismlarni alohida saqlash,
transaction rollback, nol maxraj va yaxlitlash, dashboard, marketing manbalari,
Toshkent kun chegaralari, UI tasdiq va band tugma holatlari tekshirildi.

## Brauzer

Chromium’da 7 CRM sahifasi 320, 375, 390, 699, 700, 701, 768, 900, 1024 va
1440 px kengliklarda tekshirildi: **70/70 holatda sahifa gorizontal chiqishi yo‘q**.
390 va 1440 px’da lead jadvali, voronka va yangi lead formasi screenshotlari
vizual ko‘rib chiqildi. Jadval shriftlari 13–14 px, kontrol maydonlari kamida
44 px, fokus konturi va ko‘rinadigan o‘zbekcha labellar ishlatiladi.
Jadvallar kichik ekranlarda o‘z konteyneri ichida scroll qiladi.

Brauzerda sun’iy API javoblari ishlatilgan; bu jonli demo yoki to‘liq browser
end-to-end sinovi deb talqin qilinmasin. Screen reader auditi va barcha zoom/
kontrast kombinatsiyalarining to‘liq WCAG sertifikatsiyasi bajarilmagan.
Mavjud boshqa sahifalar qayta dizayn qilinmagan.

## Qo‘llanma

API, xavfsizlik modeli, cheklovlar, konvertatsiya formulasi va demo tekshirish
qadamlari [6.2 qo‘llanmada](phase-6.2-lead-crm.md).
