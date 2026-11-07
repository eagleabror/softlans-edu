# Phase 6.6.3.1 — Xarajatlar va kassa hisoblari

## Qamrov

Xarajat kategoriyalari, xarajat qoralamalari, tasdiqlash/bekor qilish, naqd/bank/qo‘lda boshqariladigan hisoblar, boshlang‘ich qoldiq, qo‘lda kirim/chiqim, hisoblararo o‘tkazma va kunlik kassa ko‘rinishi qo‘shildi. Interfeys o‘zbek tilida, mavjud SoftLans komponentlari va uslublaridan foydalanadi.

Bu to‘liq buxgalteriya tizimi yoki yuridik muvofiqlik kafolati emas. Foyda va zarar hisoboti, bank integratsiyasi va avtomatik pul yuborish ushbu bosqichga kirmaydi. «Bank hisobi» — operator qayd etadigan hisob; haqiqiy bank tranzaksiyasi yuborilmaydi.

## Tekshirilgan mavjud arxitektura

- `billing-models.ts`: Charge, Payment, PaymentReversal, ChargeAdjustment. Payment summasi butun UZS; tenant/idempotencyKey unique. Charge yaratish pul tushumi emas.
- `billing.ts`: to‘lov, qaytarish va Charge.paidAmount bitta snapshot/majority tranzaksiyasida yangilanadi.
- `payroll-models.ts`, `payroll.ts`, `payroll-automation.ts`: Payroll qoralamasi/avtomatik hisoblash, tasdiqlash, SalaryPayout va SalaryPayoutReversal alohida. Qoralama yoki tasdiqlangan majburiyatning o‘zi kassa chiqimi emas.
- `analytics.ts`, `billingSummary`, payroll summary: mavjud hisobot hisoblari o‘zgartirilmagan. Yangi xarajatlarni mavjud daromad raqamlariga avtomatik qo‘shish yoki P&L hisoblash yo‘q.
- `billing-lock.ts`: bir tenantdagi moliyaviy yozuvlar Tenant.billingRevision orqali ketma-ketlashtiriladi; yangi modul ham shu qulfdan foydalanadi.
- `security.ts`, `app.ts`: authenticate, tenantScope, requireRoles, faol tenant, subscription entitlement, MFA, versiyalangan/revoked session va Origin/JSON yozuv himoyasi saqlangan.
- `PayrollAudit`, `ChargeAdjustment` andozalari asosida yangi `CashAudit` tashkil qilindi. Eski audit modellari o‘zgartirilmadi.
- Branch joriy `origin/main`dagi Phase 6.6.2 payroll avtomatizatsiyasi ustiga moslashtirildi.

## Saqlash va yaxlitlik

| Kolleksiya | Vazifa |
| --- | --- |
| ExpenseCategory | Tenant kategoriyasi, nomi va faol holati |
| Expense | Asl xarajat rekvizitlari, yaratuvchi, sana va holat |
| CashAccount | Hisob turi, nomi, faol holati, boshlang‘ich sana |
| CashMovement | Faqat qo‘shiladigan musbat/manfiy UZS harakatlari |
| CashOperation | Tenantga tegishli idempotency kaliti, payload fingerprint va javob |
| CashAudit | Amal, sabab, operator, oldingi/keyingi holat va vaqt |

Harakatlar va audit cheksiz embedded massiv sifatida tenant hujjatiga joylanmagan. Tenant/source/account indekslari va unique indekslar `ensureIndexes()`da yaratiladi. Yangi kolleksiyalarni yaratishdan tashqari tarixiy billing/payroll ma’lumotlarini ko‘chirish yoki qayta tasniflash talab qilinmaydi.

Barcha o‘zgaruvchan operatsiyalar MongoDB replica set tranzaksiyasida amalga oshadi; pul, holat, audit va idempotency natijasi birgalikda commit yoki rollback bo‘ladi. Tranzaksiya ichida parallel MongoDB amallari bajarilmaydi. O‘tkazma ikki harakatdan iborat: `−amount` va `+amount`; umumiy o‘zgarish 0. O‘tkazma Payment yoki oddiy Expense yaratmaydi.

Har bir yangi pul operatsiyasi UUID `idempotencyKey` oladi. Bir kalit + bir operator + bir route + bir payload takrorlansa asl javob qaytadi; o‘zgargan payload 409 qaytaradi. Serverdagi unique indeks va tenant qulfi parallel qayta so‘rovlarni ham himoya qiladi. UI tarmoq xatosidan keyingi aynan bir xil qayta urinish uchun kalitni saqlaydi. Turli kalitli ikki mustaqil harakat alohida niyat hisoblanadi; server summasi bir xil bo‘lgani uchungina qonuniy alohida to‘lovlarni birlashtirmaydi.

API bir operatsiya summasini 0–1 000 000 000 000 UZS oralig‘idagi butun son bilan chegaralaydi; 0 faqat boshlang‘ich qoldiq uchun mumkin. Boshqa pul amallari musbat. Jami summalar BigInt orqali aniq qo‘shiladi, `Number.MAX_SAFE_INTEGER`dan tashqariga chiqsa butun operatsiya rad etiladi. Float, string amount, manfiy transfer yoki bir hisobdan o‘sha hisobga o‘tkazma rad qilinadi.

Manfiy hisob qoldig‘i yashirilmaydi va soxta tushum bilan to‘ldirilmaydi. Taqsimlanmagan tarix mavjud bo‘lishi mumkinligi sababli bu bosqich overdraft siyosatini joriy qilmaydi; operator boshlang‘ich qoldiq va hisobga biriktirilgan harakatlarni tekshiradi.

CashMovement/CashOperation/CashAudit model save/update/delete/replace/bulkWrite amallari orqali qayta yozilmaydi. Expense rekvizitlari ham qayta yozilmaydi; faqat ruxsatli holat almashuvi saqlanadi. Privilegiyali raw MongoDB administratori huquqi bu dasturiy chegaradan tashqarida; bu kriptografik audit tizimi emas.

## Xarajat hayot sikli

1. Egasi yoki administrator summa, kategoriya, hisob, tavsif, sana, to‘lov usuli, ixtiyoriy yetkazib beruvchi/hujjat raqami bilan qoralama yaratadi. Bu kassa harakati yaratmaydi.
2. Faqat egasi sabab va tasdiq bilan xarajatni tasdiqlaydi. Faol tenant kategoriyasi/hisobi, usul va sana qayta tekshiriladi. CashMovement chiqimi va audit bitta tranzaksiyada yoziladi.
3. Xato qoralama bekor qilinadi va yangisi yaratiladi. Tasdiqlangan xarajat bekor qilinganda asl yozuv saqlanadi, bugungi Toshkent sanasiga teskari kirim qo‘shiladi. Tuzatish uchun keyin yangi qoralama yaratiladi.
4. Tasdiqlangan yoki bekor qilingan rekvizitlarni PATCH/DELETE orqali o‘zgartirish APIlari yo‘q. Kategoriyalar o‘chirilmaydi: qayta nomlash, faolsizlantirish va faollashtirish auditlanadi.

## Hisoblarni ishga tushirish

Egasi «Standart ro‘yxatni yaratish» orqali 8 kategoriya, Naqd kassa va Bank hisobini yaratadi. Bu tugma pul yozuvi yaratmaydi; GET so‘rovlari ham hech narsa yaratmaydi. Qo‘shimcha hisob qo‘lda yaratiladi.

Har bir hisobga kun boshidagi boshlang‘ich qoldiq, sana va sabab bir marta belgilanadi (0 ham mumkin). Shu sanadan oldingi harakat va hali boshlang‘ich qoldig‘i yo‘q hisobga pul yozish rad qilinadi. Boshlang‘ich qoldiq xatosi qayta overwrite qilinmaydi: sababli qo‘lda tuzatish harakati yoziladi. Boshlang‘ich sana xato bo‘lsa, tarixni saqlab hisobni faolsizlantirish va yangi hisob yaratish mumkin.

Qo‘lda kirim/chiqim va o‘tkazmalarni qaytarish asl yozuvni saqlaydi. O‘tkazmaning ikkala tomoni birgalikda qaytariladi. Hisob faolsizlantirilgan bo‘lsa ham ilgari yozilgan operatsiyaning teskari yozuvi o‘sha hisobga qaytishi mumkin; yangi oddiy harakatlar taqiqlanadi.

Kunlik ko‘rinish `Asia/Tashkent` sanasidan foydalanadi: kun boshi — tanlangan sanadan oldingi harakatlar; kirim/chiqim — o‘sha sana; kun oxiri — ularning yig‘indisi. Boshlang‘ich qoldiq tanlangan kunning kirimi sifatida ko‘rsatiladi va daromad hisoblanmaydi. «Joriy qoldiq» barcha mavjud sanalarning tasdiqlangan summasidir. `complete` faqat boshlang‘ich qoldiq sanasi mavjudligini bildiradi; tarixning to‘liq taqsimlanganligini tasdiqlamaydi.

## Billing/payroll integratsiyasi va review

| Holat | Kassa natijasi |
| --- | --- |
| Charge yaratish, o‘zgartirish | Harakat yo‘q |
| Payroll qoralamasi, avtomatik hisoblash, approve | Harakat yo‘q |
| Yangi Payment + cashAccountId | Asl Payment tranzaksiyasida bitta kirim |
| Yangi SalaryPayout + cashAccountId | Asl payout tranzaksiyasida bitta chiqim; Expense yaratilmaydi |
| Hisobsiz Payment/SalaryPayout | Eski ish oqimi davom etadi; taqsimlanmagan tarixda turadi |
| Hisobga biriktirilgan PaymentReversal/SalaryPayoutReversal | Asl hisobga bugungi sana bilan teskari harakat |
| Hisobsiz eski to‘lovni qaytarish | Kassa yozuvi yaratilmaydi |
| Takroriy source request yoki reversal | Ikkinchi kassa yozuvi yaratilmaydi |

`cashAccountId` yangi so‘rovdagi ixtiyoriy maydon. Payment/SalaryPayout tarixiy sxemasi va mavjud hujjatlari o‘zgartirilmadi. Billing va payroll fingerprintlarida hisob tanlovi ham tekshiriladi; eski hisobsiz fingerprint formatiga moslik saqlanadi. Sourcega bog‘langan kirim/chiqim uchun tenant/kind/source unique indeks qo‘shimcha himoya beradi. Hisob, to‘lov usuli, boshlang‘ich sana yoki raqam chegarasi noto‘g‘ri bo‘lsa, source to‘lovi ham to‘liq rollback bo‘ladi.

Tarixiy allocation/backfill endpointi yo‘q. «Hisobga taqsimlanmagan tarix» barcha sanalardagi qaytarilmagan, cash manbasi yo‘q Payment va SalaryPayout summalarini alohida ko‘rsatadi. Bu summalar hisob qoldig‘iga qo‘shilmaydi. Boshlang‘ich qoldiq bilan eski to‘lovlarni ikki marta hisoblash avtomatik taxmin orqali amalga oshirilmaydi.

Pul oqimi — pulning kirishi/chiqishi; tan olingan daromad/xarajat — boshqa hisoblash siyosati. Ta’lim uchun hisob chiqarish pul qabul qilish emas, payroll hisoblash maosh to‘lash emas. Maoshni «Xarajatlar» yoki «Boshqa chiqim»ga ikkinchi marta kiritmaslik UI matnida eslatiladi. Oddiy xarajat APIlarida payroll/payment source turi berilmaydi.

## Ruxsatlar

| Rol | Huquq |
| --- | --- |
| Business Owner | Barcha yangi modul yozuvlari, tasdiqlash/qaytarish, hisob/kategoriya, boshlang‘ich qoldiq |
| Administrator | Qoralama yaratish; faqat o‘zi yaratgan, hali qoralama holatidagi yozuvlarni ko‘rish; qoralama uchun faol hisob/kategoriya nomlari |
| Teacher | Xarajat/kassa API va menyulariga kirish yo‘q |
| Super Admin | Oddiy tenant APIlari orqali kirish yo‘q |

Administratorga umumiy balans, pul harakatlari, boshqa foydalanuvchi yozuvlari yoki umumiy audit berilmaydi. Alohida kengaytirilgan moliyaviy grant mexanizmi qo‘shilmagan. Barcha reference va idempotency qidiruvlari server principalidan olingan tenant bilan chegaralangan. Client tenantId yuborishi strict validation bilan rad etiladi.

## API va sahifalar

Barcha yangi endpointlar `/api/cash` ostida:

- GET `draft-options`, `expenses`, `expenses/:id`.
- POST `setup`, `expenses`, `expenses/:id/confirm`, `expenses/:id/void`.
- GET/POST `categories`, `accounts`; PATCH `categories/:id`, `accounts/:id`.
- POST `accounts/:id/opening`, `movements`, `movements/:id/void`.
- GET `movements`, `daily`, `audit/:id`.

Yozuvlar ro‘yxati 20 tadan sahifalanadi (API maksimum 100). Xarajatlar sana/kategoriya/holat/hisob, pul harakatlari sana/hisob bo‘yicha filtrlanadi. Hisob/kategoriya sozlamalari ro‘yxati kichik konfiguratsiya ro‘yxati sifatida to‘liq olinadi. Balans va taqsimlanmagan tarix hozircha aniq ledger skani orqali hisoblanadi; juda katta tenant tarixi uchun keyingi alohida optimizatsiyada Decimal128 aggregatsiya yoki tranzaksion cache va reconciliation kerak bo‘lishi mumkin.

Sahifalar: `/expenses`, `/expenses/new`, `/expenses/:id`, `/expenses/categories`, `/cash/accounts`, `/cash/movements`, `/cash/daily`.

## Tekshiruv va dalillar

Yakuniy natija: `npm test` — API 532 passed + 1 skipped, UI 131 passed (jami 663 passed); yangi cash testlari 18/18. `npm run typecheck`, `npm run build`, brauzer assertions va ikkala dependency audit o‘tdi; auditlarda 0 zaiflik.

Haqiqiy loglar va desktop/mobile rasmlar: [artifacts/phase-6.6.3.1](../artifacts/phase-6.6.3.1/README.md).

Yangi backend testlari disposable `MongoMemoryReplSet` MongoDB 7.0.24da ishlaydi; operator bergan yoki production MONGODB_URI ishlatilmaydi. Screenshot skripti ham faqat o‘zi yaratgan lokal sintetik bazani ishlatadi va oxirida uni to‘xtatadi.

Qamrov: xarajat yaratish/tasdiqlash/bekor qilish; kategoriya boshqaruvi; boshlang‘ich qoldiq; ikki tomonli o‘tkazma/qaytarish; parallel/duplicate so‘rov; payload collision; integer aniqligi va overflow rollback; noto‘g‘ri sana/usul; tarixni saqlash; payroll double-counting; payment allocation/reversal; tenant/RBAC/CSRF/MFA/session; yopilgan hisobga reversal.

Brauzer: haqiqiy API + production build, 7 sahifa × 2 qurilma, har sahifada 320/375/390/699/700/701/768/900/1024/1440px. Dialog fokusi, Escape va real UI void tekshirildi. Asosiy sarlavhalar, uzun o‘zbekcha matn, mahalliy table scroll va mobil sahifalar tekshirildi.

Build mavjud katta bundle va FinancialReports static/dynamic import ogohlantirishlarini chiqaradi; ular buildni to‘xtatmaydi. Native backup/restore DR drill oddiy `npm test`da shartli o‘tkazib yuboriladi; bajarilgan testlar va skip soni logda ochiq ko‘rsatiladi.

Merge/deploy bajarilmadi. Production mijoz ma’lumoti olinmadi. Pullik xizmat qo‘shilmadi.
