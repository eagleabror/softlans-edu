# 6.3.2 — SaaS tariflar, obunalar va qo‘lda to‘lov tasdiqlash

Bu modul markazning SoftLans Edu platformasidan foydalanish obunasini boshqaradi. O‘quvchilar to‘lovlari, qarzlari, davomat va ish haqi hisoblari mavjud alohida modullarda qoladi. SaaS to‘lovi hech qachon o‘quvchi to‘lovi sifatida yozilmaydi. Click, Payme, Uzum yoki boshqa to‘lov gateway integratsiyasi qo‘shilmagan.

## Ma’lumotlar va pul hisoblari

Platforma darajasidagi `SaasPlan` tariflari tenantga bog‘lanmaydi. Boshlang‘ich tariflar: Starter — oyiga 149 000 UZS, 100 faol o‘quvchi va 10 faol guruh; Standard — 299 000 UZS, 300 faol o‘quvchi va 30 faol guruh; Pro — 499 000 UZS, ikkala limit ham cheklanmagan. Bu qiymatlar bazadagi tahrirlanadigan boshlang‘ich yozuvlardir. `null` limit cheklanmaganlikni bildiradi; `0` nol o‘rin degani.

`SaasSubscription` har bir tenant uchun bitta joriy obunani saqlaydi. Tarif nomi, kodi, kelishilgan oylik narx, limitlar va imkoniyatlar snapshot sifatida saqlanadi. Tarif katalogini tahrirlash mavjud obuna yoki yuborilgan to‘lov so‘rovining snapshotini o‘zgartirmaydi. Tarifni faolsizlantirish eski ma’lumotni o‘chirmaydi.

`SaasPaymentRequest` SaaS to‘lovi haqida egasi bildirgan ma’lumotni saqlaydi: tanlangan tarif, oylar soni, server hisoblagan butun UZS summa, to‘lov sanasi, usuli, tranzaksiya izohi, ko‘rib chiqish holati va idempotency kaliti. `pending` so‘rov pul kelganini tasdiqlamaydi. `approved` faqat Super Admin tashqi bank ma’lumotini tekshirgach bajaradigan amal natijasidir.

`SaasAudit` platforma SaaS amallari va obuna o‘zgarishlari tarixini saqlaydi. `SaasTrialGrant` tenantga sinov muddati ilgari berilganini alohida qayd etadi. `SaasSettings` Super Admin tasdiqlagan to‘lov yo‘riqnomasini saqlaydi. `SaasReminder` ilova ichidagi eslatmalar uchun alohida, tenantga bog‘langan yozuvdir. Telegram yetkazish mavjud `NotificationJob` navbatidan foydalanadi.

Barcha narx va summalar butun UZS birliklarida hisoblanadi; kasrli qiymatlar qabul qilinmaydi. Obuna holati va tugash chegarasi server vaqti bilan tekshiriladi. Interfeysdagi vaqtlar `Asia/Tashkent` bo‘yicha ko‘rsatiladi.

## Mavjud markazlarni xavfsiz o‘tkazish

Migratsiya qo‘shimcha kolleksiya va indekslarni yaratadi; mavjud tenant, student, group, attendance yoki student payment ma’lumotlarini qayta yozmaydi yoki o‘chirmaydi. Startup’dagi mavjud `ensureIndexes()` mexanizmi yangi indekslarni tayyorlaydi. MongoDB replica set va tranzaksiyalar talab qilinadi.

Obunasi hali biriktirilmagan eski tenant avvalgi kirish huquqini saqlaydi. Unga avtomatik 14 kunlik trial berilmaydi va rollout vaqtida birdan read-only cheklovi qo‘yilmaydi. Ushbu o‘tish holati pullik faol obuna hisoblanmaydi va MRR’ga qo‘shilmaydi. Super Admin har bir eski markazni tekshirib, unga obunani alohida biriktiradi. Barcha eski markazlarga yashirin ommaviy yangilash yoki muddatsiz bepul obuna yaratish yo‘q.

Tavsiya etilgan rollout tartibi:

1. Odatdagi ma’lumotlar bazasi backup tartibiga amal qiling va o‘zgarishni alohida test bazasida tekshiring.
2. Ilova ishga tushganda yangi kolleksiya va unique indekslar muvaffaqiyatli tayyorlanganini tekshiring. Indeks xatosi bo‘lsa cheklovlarni aylanib o‘tmang.
3. Super Admin sifatida tariflar va narxlarni tekshiring, kerak bo‘lsa tahrirlang.
4. To‘lov yo‘riqnomasini tasdiqlang. Bank rekvizitlarini ommaviy source fayl yoki environment secret o‘rniga ushbu boshqariladigan konfiguratsiyaga kiriting.
5. Eski markazlarni navbat bilan ko‘rib chiqing; shartnoma yoki tekshirilgan to‘lov asosida obuna biriktiring. Bepul sinov kerak bo‘lsa uni alohida, aniq Super Admin amali orqali bir marta bering.
6. Markaz egasi hisobida o‘qish, yozish, limitlar va to‘lov so‘rovi oqimini tekshiring.

Yangi markaz uchun ro‘yxatdan o‘tish tranzaksiyasi 14 kunlik trial yaratadi. Tenant yaratish yoki owner yaratish muvaffaqiyatsiz bo‘lsa trial ham saqlanmaydi. Oldin berilgan trial belgisi obuna davri almashganda saqlanadi; ayni tenantga takroriy trial rad etiladi.

Oldingi kodga rollback yangi SaaS cheklovlarini o‘chirib qo‘yadi. Shuning uchun obunalar ishga tushganidan so‘ng kodni orqaga qaytarish billing siyosatiga ham ta’sir qilishini hisobga oling; yangi moliyaviy va audit kolleksiyalarini o‘chirmang.

Production oldidan faqat o‘qiydigan hisobot: `npm run saas:migration:report -w @softlans/api`. U jami, bloklangan, obunasiz va takroriy obunali tenant sonlarini chiqaradi; indeks yaratmaydi, trial bermaydi va ma’lumotlarni o‘zgartirmaydi. Ushbu ishda production bazada bajarilmadi.

## Super Admin yo‘riqnomasi

Oddiy login orqali platforma hisobiga kiring. Mavjud Super Admin provisioning tartibi saqlangan; markaz owner/admin/teacher hisobi platforma hisobiga aylantirilmaydi.

- **Tariflar** — `/super-admin/plans`: tarif yaratish, nom/narx/limit/imkoniyatlarni tahrirlash va faolsizlantirish. Tarif katalogidagi yangi narx eski snapshotlarni o‘zgartirmasligini hisobga oling.
- **Obunalar** — `/super-admin/subscriptions`: markazni tanlash, tarif biriktirish, trial berish, uzaytirish, tarif almashtirish, to‘xtatish, qayta faollashtirish va tarixni ko‘rish. Markaz tafsilotidan shu boshqaruvga o‘tish mumkin.
- **To‘lov so‘rovlari** — `/super-admin/payment-requests`: pending/approved/rejected filtrlari, markaz va sana bo‘yicha qidirish, to‘lov tafsilotlarini ochish.
- **SaaS analitika** — `/super-admin/saas-analytics`: faol pullik obunalar, trial va tugagan obunalar, kutilayotgan so‘rovlar, tasdiqlangan summalar, tariflar bo‘yicha markazlar va MRR.

To‘lovni tasdiqlash tartibi:

1. So‘rovdagi markaz, tarif, davr, summa, to‘lov sanasi va izohni tekshiring.
2. Tashqi bank yoki to‘lov hisoboti orqali mablag‘ haqiqatda kelganini mustaqil tekshiring. Foydalanuvchining “to‘ladim” degan xabari yetarli emas.
3. Tasdiqlash oynasidagi bank tekshiruvi tasdig‘ini belgilang va operatsion izoh kiriting. Izohga parol, token yoki boshqa maxfiy ma’lumot yozmang.
4. Tasdiqlangandan so‘ng so‘rov, obuna muddati va audit tarixini tekshiring. So‘rovni tasdiqlash, obunani yangilash va audit bitta MongoDB tranzaksiyasida bajariladi.
5. Pul kelmagan yoki mos kelmagan bo‘lsa sabab bilan rad eting. Rad etish obunani faollashtirmaydi.

Bir so‘rovni takroran yoki parallel tasdiqlash obunani ikki marta uzaytirmaydi. Javob yo‘qolsa holatni yangilang; yangi so‘rov yaratib ayni to‘lovni qayta tasdiqlamang.

Tenantni ma’muriy bloklash va obunani to‘xtatish ikki alohida amal. To‘lov tasdiqlash ma’muriy blokni bekor qilmaydi. Bloklangan tenant uchun oldingi ma’muriy kirish siyosati saqlanadi.

## Markaz egasi yo‘riqnomasi

**Sozlamalar → Obuna va tariflar** (`/settings/subscription`) bo‘limini oching. Joriy tarif, snapshot narxi, holati, tugash sanasi, qolgan kunlar, faol o‘quvchi/guruh sonlari va limitlarni ko‘ring. Obunalar taqqoslashidan kerakli tarifni tanlang.

Super Admin tasdiqlagan to‘lov yo‘riqnomasi bo‘lsa, undagi ko‘rsatmalar asosida to‘lov qiling. So‘ng tarif va to‘lov davrini tanlab, to‘lov sanasi, usuli va tranzaksiya izohi bilan so‘rov yuboring. Server summani tarif asosida hisoblaydi; brauzerdan yuborilgan soxta summa qabul qilinmaydi.

So‘rov **Kutilmoqda** holatida qoladi. Super Admin bankdan tushumni tekshirib tasdiqlagandan keyin obuna yangilanadi. To‘lov tarixidan holat va tekshiruv izohini kuzating. Tarmoq uzilganda ayni formadagi qayta urinish mavjud idempotency kalitini saqlaydi.

Admin va Teacher rollari SaaS billing’ni boshqara olmaydi. Obuna tugaganda ularga cheklov haqida xabar va markaz egasiga murojaat qilish yo‘riqnomasi ko‘rsatiladi. Egaga obunani yangilash bo‘limiga havola beriladi.

## Read-only rejimi va tarif limitlari

Faqat muddati tugamagan `active` yoki `trialing` obuna tenant yozish amallariga ruxsat beradi. `past_due`, `expired`, `suspended`, `cancelled` holatlarida mavjud CRM ma’lumotlarini o‘qish saqlanadi; yozish serverda cheklanadi. Tugash vaqtini tekshirish schedulerga bog‘liq emas. SaaS to‘lov so‘rovi/yangilash va logout kabi xavfsiz kirish operatsiyalari ochiq qoladi. Eski student billing yozishlari ushbu istisnoga kirmaydi.

Limit faol (`active`) o‘quvchi va guruhlar soniga qo‘llanadi. O‘quvchi yaratish, holatini faolga qaytarish, Excel import, leaddan o‘quvchi yaratish, guruh yaratish va qayta faollashtirishda backend tekshiruvi ishlaydi. Hisoblash va yozish bitta tranzaksiyada, tenantning umumiy revision yozuvi orqali serializatsiya qilinadi; parallel so‘rovlar bir xil bo‘sh o‘rinni egallay olmaydi.

Limit kamayganda mavjud yozuvlar o‘chirilmaydi. Yangi faol yozuv limiti oshirsa, tarifni yangilash yoki faol yozuvlar sonini kamaytirish haqida tushunarli xabar qaytadi. Arxivlangan yozuvlar saqlanadi.

## MRR ma’nosi

MRR — amaldagi pullik takrorlanuvchi obunalarning kelishilgan oylik qiymati. Trial, muddati tugagan va bekor qilingan obunalar MRR’ga kirmaydi. MRR bankka tushgan real pul summasi emas. Tasdiqlangan qo‘lda to‘lov so‘rovlari summasi alohida ko‘rsatkichdir; u MRR bilan qo‘shilmaydi. Ushbu bosqichda gateway orqali bank reconciliation, refund yoki bir martalik daromad modeli yo‘q.

## Render Free va eslatmalar

Doimiy background worker yoki yangi Render resursi talab qilinmaydi. Mavjud autentifikatsiyalangan scheduler manzili qayta ishlatiladi:

```text
POST /api/internal/notifications/run
Authorization: Bearer <mavjud alohida scheduler maxfiy kaliti>
Content-Type: application/json

{}
```

Tashqi scheduler ushbu HTTPS manzilga davriy POST yuborishi kerak. `NOTIFICATION_SCHEDULER_SECRET` mavjud server konfiguratsiyasi va schedulerning maxfiy header saqlash joyida mos bo‘lishi kerak; JWT, Telegram yoki MongoDB credentials’ini schedulerga bermang. Maxfiy qiymatni URL, source kod yoki logga yozmang. Ushbu PR scheduler yaratmaydi, secrets’ni o‘zgartirmaydi va deploy qilmaydi.

Obuna tugashiga 7, 3 va 1 kun qolgan oynalarda ilova ichidagi eslatma yaratiladi. Unique kalit tenant, obuna, ayni tugash sanasi va kun oralig‘ini qamrab oladi; takroriy yoki parallel scheduler ayni eslatmani ko‘paytirmaydi. Obuna uzaytirilganda yangi tugash sanasi uchun keyingi eslatmalar alohida hisoblanadi.

Ilova ichidagi eslatma Telegram konfiguratsiyasiz ham ishlaydi. Telegram eslatmasi faqat faol markaz egasining ulangan akkaunti va yoqilgan xabar roziligi bo‘lsa rejalashtiriladi. Yuborishdan oldin jonli rol, tenant, integratsiya revision’i, rozilik va obuna davri qayta tekshiriladi. Mavjud quiet-hours va yetkazish mexanizmi saqlanadi.

Render Free uxlab qolishi, cold start yoki qayta ishga tushishi mumkin. HTTP `202` faqat batch qabul qilingani yoki oldingi batch ishlayotgani sabab o‘tkazib yuborilganini bildiradi, xabar yetganini emas. Keyingi scheduler chaqiruvi saqlangan navbatni davom ettiradi. 7/3/1 kunlik oynalar o‘tkazib yuborilmasligi uchun scheduler kamida har soatda yoki mavjud tezlikda ishlashi tavsiya qilinadi; uzoq uzilishda o‘tgan eslatma oynasi qayta yaratilishi kafolatlanmaydi. Bu har doim ishlaydigan yetkazish kafolati emas.

Mavjud build/start komandalarini almashtirish shart emas. Bir Node web service React va API’ni xizmat qiladi. Mahalliy `render.yaml` tarixiy deployment parametrlarini o‘z ichiga oladi; bu PR uni jonli Render sozlamalarining tasdig‘i sifatida ishlatmaydi.

## Xavfsizlik chegaralari va tekshirish

SaaS boshqaruv endpointlari joriy server-side rolni tekshiradi. Tenant egasi tenantni sessiyadan oladi; so‘rov tanasi yoki query’dagi boshqa tenant ID orqali begona obuna/to‘lovga kira olmaydi. Super Admin uchun yangi SaaS huquqlari tenantning ichki student payments API’siga kirish huquqini bermaydi.

JWT cookie’ning HttpOnly, production Secure va SameSite siyosati, Origin asosidagi CSRF himoyasi, qat’iy input validatsiyasi va rate limitlar saqlanadi. API faqat ruxsat etilgan maydonlarni oladi. To‘lov so‘rovlari tenant+idempotency kaliti bilan unique; tasdiqlash atomik status tekshiruvi va tranzaksiya bilan himoyalangan. Auditni tahrirlash yoki o‘chirish API’si yo‘q. Bu DB administratorining bevosita yozish huquqiga qarshi kriptografik himoya emas.

Tekshirish buyruqlari:

```sh
npm test
npm run typecheck
npm run build
npm audit --audit-level=high
npm audit --omit=dev --audit-level=high
git diff --check
```

Avtomatik DB testlari alohida vaqtinchalik MongoDB replica setda bajariladi; production ma’lumotlariga test yuborilmaydi. Aynan bajarilgan tekshiruvlarning natijalari PR hisobotida beriladi.

## Ma’lum cheklovlar

- To‘lovni tekshirish inson tomonidan bajariladi; yuborilgan so‘rov bank dalili emas.
- To‘lov cheki faylini yuklash ushbu bosqichga kiritilmagan. Ilova xostining vaqtinchalik diskida moliyaviy fayl saqlash joriy qilinmaydi.
- Gateway, avtomatik debet, refund, soliqqa oid invoice va valyuta konvertatsiyasi qo‘shilmagan.
- Eski obunasiz markazlar Super Admin ularni biriktirguncha avvalgi huquqlarini saqlaydi; ularni bosqichma-bosqich o‘tkazish operator vazifasidir.
- Obuna va ma’muriy tenant blokirovkasi alohida. To‘lov tenant ma’muriy blokini avtomatik olib tashlamaydi.
- Eslatmalar tashqi scheduler davriyligi va Render Free mavjudligiga bog‘liq. Telegram’ga aynan bir marta yetkazishni tashqi tarmoq noaniqliklarida mutlaq kafolatlash mumkin emas.
- Rate limitlarning mavjud in-process qismi instansiyalar o‘rtasida umumiy emas; moliyaviy idempotency, quota va scheduler dedup himoyalari MongoDB’da umumiy saqlanadi.

Brauzerda mobil o‘lchamlar va vizual accessibility tekshiruvi ushbu muhitda bajarilmadi; React Testing Library testlari vizual tekshiruv o‘rnini bosmaydi.

## Yakuniy tekshiruv — 2026-11-05

- `npm test`: API 25 faylda 387/387, UI 17 faylda 89/89; jami 476 test o‘tdi. Mavjud CRM regressiya testlari ham shu to‘plamga kiradi.
- `npm run typecheck` va `npm run build`: muvaffaqiyatli. Oxirgi UI idempotency o‘zgarishidan keyin web typecheck, build va tegishli 6 test qayta o‘tkazildi.
- `npm audit --audit-level=high` va `npm audit --omit=dev --audit-level=high`: har ikkisida 0 zaiflik.
- `git diff --check`: xatosiz. Production migration yoki deploy bajarilmadi.
