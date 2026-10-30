# 6.3.1 — Super Admin va o‘quv markazlarini boshqarish

Platforma boshqaruvi mavjud CRM’dan ajratilgan. Tariflar, subscriptions, SaaS billing, to‘lov provayderlari va ommaviy xabar yuborish bu bosqichga kirmaydi.

## Kirish va sahifalar

Mavjud xavfsiz `npm run provision:super-admin` mexanizmi saqlangan: u faqat yangi email bilan `tenantId: null` platforma hisobini yaratadi. Mavjud markaz hisobini Super Admin’ga aylantirmaydi. `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_NAME`, `SUPER_ADMIN_PASSWORD` qiymatlari faqat operatorning maxfiy muhiti orqali beriladi va provisioningdan so‘ng olib tashlanadi. Ommaviy Super Admin ro‘yxatdan o‘tishi yo‘q.

Oddiy `/login` sahifasida provision qilingan hisob bilan kiring. Server qaytargan sessiya asosida alohida panel ochiladi:

- `/super-admin` — platforma ko‘rsatkichlari va markazlar o‘sishi;
- `/super-admin/tenants` — qidiruv, status filtri va sahifalangan markazlar;
- `/super-admin/tenants/:id` — markaz tafsilotlari, egasining minimal akkaunt ma’lumoti, bloklash/faollashtirish;
- `/super-admin/audit` — amallar tarixi, markaz bo‘yicha filtr.

## API

Barcha quyidagi manzillar `/api/super-admin` prefiksi ostida; autentifikatsiya va serverdagi joriy `super_admin` roli talab qilinadi.

| Usul | Manzil | Vazifa |
| --- | --- | --- |
| GET | `/stats` | MongoDB’dan platforma agregatlari va 30 kunlik kunlik o‘sish |
| GET | `/tenants?page=1&search=nom&status=active` | Markazlar; `status`: `active` yoki `blocked`, ixtiyoriy |
| GET | `/tenants/:id` | Markaz, agregat sonlar, egasining ID/ismi/emaili |
| POST | `/tenants/:id/block` | Sabab va kutilayotgan revision bilan bloklash |
| POST | `/tenants/:id/activate` | Sabab va kutilayotgan revision bilan faollashtirish |
| GET | `/audit?page=1&tenantId=…` | Barcha yoki bitta markaz amallari |

Status amali tanasi: `{ "reason": "Operatsion tekshiruv", "expectedRevision": 0 }`. Revisionni markaz tafsilotlaridagi `statusRevision` qiymatidan oling. Sabab 3–300 belgi; parol, token, telefon, email yoki boshqa shaxsiy ma’lumot kiritmang. Xato formati mavjud `{error:{code,message,requestId,fields?}}` konvensiyasini saqlaydi. POST uchun konfiguratsiyadagi aniq `Origin` va `application/json` kerak.

Takroriy holat yoki eskirgan revision `409 STATUS_CONFLICT` qaytaradi; qo‘shimcha audit yozilmaydi. Holatni qayta yuklang va yangi ma’lumotni tekshirib tasdiqlang. So‘rov muvaffaqiyatli bo‘lganidan keyin tarmoq javobi yo‘qolsa, ko‘r-ko‘rona takrorlash o‘rniga tafsilot va auditni tekshiring.

## Ma’lumot ma’nosi va cheklovlar

- Jami markazlar faol va bloklangan markazlarni qamrab oladi.
- Jami foydalanuvchilar barcha saqlangan akkauntlarni, jumladan faol bo‘lmaganlar va platforma hisoblarini qamrab oladi.
- Jami o‘quvchilar barcha saqlangan o‘quvchi hujjatlari, jumladan arxivlangan yozuvlarni sanaydi. Individual yozuvlar ochilmaydi.
- Bugun va oxirgi 30 kun `Asia/Tashkent` bo‘yicha hisoblanadi: bugun va undan oldingi 29 kalendar kun. Grafik har kundagi yangi markazlarni ko‘rsatadi. Haqiqiy natijada markaz qo‘shilmagan kunlar nol bo‘ladi.
- Mavjud modelda ishonchli oxirgi faollik manbasi yo‘q: `lastActivityAt: null`. `updatedAt` faollik deb talqin qilinmaydi. Egasi topilmasa `owner: null`.
- Ro‘yxatlar 20 tadan, sahifa 1–10000, qidiruv 120 belgigacha. MongoDB o‘qishlari 3 soniya bilan, agregatsiya diskka yozmasdan cheklangan. Katta bazada timeout bo‘lsa qiymat uydirilmaydi — xato qaytariladi.
- Panel 60 so‘rov/daqiqa/operator, status amallari 20 so‘rov/daqiqa/operator bilan cheklangan; mavjud umumiy IP limiti ham saqlanadi. In-process limiter ko‘p instansiya orasida umumiy emas.

## Xavfsizlik va audit

JWT imzosi, issuer/audience, amal muddati va sessionVersion saqlangan. Har yangi autentifikatsiyalangan so‘rov akkaunt roli va markaz faolligini bazadan tekshiradi. Frontend, query yoki JWT ichidagi soxta rol server ruxsatini bermaydi. Super Admin tenantning o‘quvchi, ota-ona, moliyaviy yoki CRM yozuvlariga avtomatik kira olmaydi.

Bloklash status, revision, barcha markaz akkauntlarining sessionVersion’i va audit yozuvini bitta MongoDB tranzaksiyasida saqlaydi. Xatoda hammasi bekor qilinadi. Faollashtirish eski sessiyalarni tiklamaydi; foydalanuvchilar qayta login qiladi. MongoDB replica set talab qilinadi. Legacy markazlarda mavjud bo‘lmagan revision nol sifatida olinadi; oldindan ma’lumot migratsiyasi talab qilinmaydi. Indekslar mavjud startup mexanizmida yaratiladi.

Audit operator ID, markaz ID, amal, operatsion sabab, vaqt, oldingi/yangi status va revisionni saqlaydi. Akkaunt snapshotlari, parollar, tokenlar yoki o‘quvchi ma’lumotlari yozilmaydi. Audit uchun tahrirlash/o‘chirish API’si yo‘q; model update/delete amallarini ham rad etadi. Bu DB administratoridan kriptografik himoya emas: bevosita bazaga yozish huquqi alohida boshqariladi. Erkin matnda barcha turdagi shaxsiy ma’lumotni avtomatik aniqlash kafolati yo‘q; operator sababga faqat operatsion izoh yozishi kerak.

Bloklashdan oldin autentifikatsiyadan o‘tib bo‘lgan in-flight so‘rovni umumiy holda orqaga qaytarish kafolatlanmaydi. Bloklash commitidan keyingi yangi autentifikatsiyalangan so‘rovlar rad etiladi. Platforma hisobining tenant’i yo‘q; platforma hisobi tenantga noto‘g‘ri bog‘langan legacy holat ham himoyalanadi. Hech qanday tenant ma’lumoti o‘chirilmaydi.

## Demo ma’lumotlarda tekshirish

1. Alohida mahalliy development MongoDB replica setdan foydalaning. Render yoki production Atlas credentials’ini o‘zgartirmang.
2. Mavjud development seed yo‘riqnomasi bo‘yicha `NODE_ENV=development`, `SEED_DEMO=true` va maxfiy `SEED_PASSWORD` bilan `npm run seed:dev` bajaring. Bu bitta demo markaz va owner/admin/teacher hisoblarini yaratadi; takroriy email bo‘lsa rad etadi. Seed o‘quvchi yaratmaydi, shuning uchun boshlang‘ich o‘quvchi soni haqiqatan nol.
3. Shu lokal bazada alohida email bilan mavjud provisioning buyrug‘ini bajaring, provisioning qiymatlarini olib tashlang. `npm run dev` orqali ilovani ishga tushiring.
4. Super Admin bilan `/login` orqali kiring. Markaz, egasi, sonlar, qidiruv va status filtrini tekshiring. Real demo o‘quvchi qo‘shish uchun markaz egasi bilan CRM’dan foydalaning.
5. Boshqa browser profilida demo owner bilan kiring. Super Admin panelida sabab kiritib bloklashni tasdiqlang. Ownerning keyingi so‘rovi va yangi login’i rad etilishini tekshiring.
6. Markazni qayta faollashtiring. Eski cookie ishlamasligi, yangi login ishlashi, ma’lumot saqlanishi va auditda ikki amal paydo bo‘lishini tekshiring.
7. Oddiy owner bilan `/api/super-admin/stats` so‘rovi `403` bo‘lishini, Super Admin bilan `/api/students` va moliyaviy endpointlar yopiq qolishini tekshiring.

Avtomatik testlar production bazaga ulanmaydi: vaqtinchalik MongoDB replica setdan foydalanadi. Buyruqlar: `npm test`, `npm run typecheck`, `npm run build`, `npm audit --audit-level=high`, `npm audit --omit=dev --audit-level=high`. Maxsus test: `npm run test -w @softlans/api -- tests/super-admin.test.ts`.

## Ushbu o‘zgarish tekshiruvlari

- To‘liq `npm test`: API 364/364, frontend 77/77 test muvaffaqiyatli. Shundan Super Admin uchun 19 ta API va 11 ta frontend testi yangi.
- Workspace typecheck va production build muvaffaqiyatli.
- To‘liq va production dependency audit: 0 zaiflik.
- Chromium’da to‘rtta sahifa 320, 375, 390, 699, 700, 701, 768, 1024 va 1440 px kengliklarda tekshirildi: sahifa bo‘ylab gorizontal overflow yo‘q. Modalning dastlabki fokusi, Escape, tugmaga fokusni qaytarish va bloklashdan keyingi holat yangilanishi tekshirildi; browser xatosi yo‘q. Browser tekshiruvi faqat UI fixturelardan, API testlari esa haqiqiy vaqtinchalik MongoDB’dan foydalandi.
- Render/Atlas credentials o‘zgartirilmadi; avtomatik deploy yoki merge bajarilmadi.
