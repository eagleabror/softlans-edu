# Phase 6.5.4 — Xavfsiz qo‘lda billing va maosh boshqaruvi

## Tekshirilgan asos

2026-11-09 kuni GitHub `main`: `872fd4e0930dfdf573ae20b2cc9a0d35836541a0`.
PR [#40](https://github.com/eagleabror/softlans-edu/pull/40) 2026-11-07
06:46:06 UTC da, [#41](https://github.com/eagleabror/softlans-edu/pull/41)
06:47:13 UTC da merge qilingan.

Qo‘lda ishlash uchun yangi moliyaviy modul yoki alohida rejim bayrog‘i kerak emas.
`BILLING_SCHEDULER_SECRET`, `PAYROLL_SCHEDULER_SECRET` va
`NOTIFICATION_SCHEDULER_SECRET` konfiguratsiyada ixtiyoriy. Ular yo‘q bo‘lsa
foydalanuvchi sessiyasi orqali ishlaydigan billing va maosh endpointlari ishlaydi.
Bu tekshiruv production sozlamalari o‘zgartirildi yoki production tizimi
tekshirildi degani emas.

## Administrator oylik hisoblarni qanday yaratadi?

1. Vakolatli **Administrator** yoki **Biznes egasi** sifatida tizimga kiring.
2. **To‘lovlar → Oylik hisoblar** ekranida **Hisob oyi**ni tanlang. Guruh,
   o‘quvchi va holat filtrlari ko‘rish uchundir: yaratish tanlangan oy uchun
   markazdagi barcha mos faol a’zoliklarni qamrab oladi.
3. **Oylik hisob yaratish**ni bosing. Dialogdagi oy va to‘lov muddati kunini
   tekshiring. Muddati 1–28 oralig‘ida bo‘lishi mumkin; bu tanlov yangi
   hisoblarga qo‘llanadi.
4. **Ommaviy hisob yaratishni tasdiqlayman** belgisini qo‘ying va
   **Tasdiqlash va yaratish**ni bosing.
5. Natijadagi **Yaratildi**, **O‘tkazib yuborildi**, **Xatolar** sonlarini
   tekshiring. Mavjud hisoblar yoki mos kelmagan a’zoliklar o‘tkazib yuboriladi.

Amal mavjud `POST /api/billing/charges/generate` endpointiga
`{ month: "YYYY-MM", dueDay: 10, confirmed: true }` yuboradi. Endpoint
billing scheduler secretini talab qilmaydi. Markaz sessiyadan aniqlanadi;
klient boshqa markazni yoki hisob yaratuvchi shaxsni tayinlamaydi.

Billing bir markaz uchun bitta tranzaksiyada bajariladi. Tasdiqlangan muvaffaqiyatli
javobda xatolar soni 0; individual xatolarni tashlab, qisman muvaffaqiyat qaytarish
mexanizmi yo‘q. Server xatosida tranzaksiya bekor qilinadi va xato ko‘rsatiladi.
Aloqa uzilib, natija noma’lum qolsa, avval hisoblar ro‘yxatini tekshiring; ayni
oyni qayta yaratish mavjud hisoblarni takrorlamaydi. Noma’lum natija uchun
ishonchsiz yaratilgan/xato sonlari ko‘rsatilmaydi.

Dars jadvali, guruh boshlanishi, a’zolik va billing siyosati asosidagi Phase 6.6.1
proratsiyasi saqlanadi. Faol guruh, faol o‘quvchi va mos faol a’zolik talab qilinadi.
Bir xil markaz/o‘quvchi/guruh/oy hisobi qayta yaratilmaydi; to‘langan, qisman
to‘langan, bekor qilingan va eski hisoblar qayta hisoblanmaydi yoki almashtirilmaydi.
Tarixiy oy uchun yaratish o‘sha paytdagi butun a’zolik tarixini tiklamaydi:
xizmat hozir faol bo‘lgan a’zoliklarni tanlaydi. Eski davrni to‘ldirishdan oldin
ro‘yxat va qoidalarni tekshiring.

## Qarz va to‘lov yozuvlarini tekshirish

- **Holat** filtridan **To‘lanmagan**, **Qisman**, **To‘langan** yoki
  **Bekor qilingan**ni tanlang. Hisob, to‘langan summa va qoldiqni solishtiring.
- **Darslar bo‘yicha hisob** orqali saqlangan hisoblash asosini ko‘ring.
- **To‘lov qo‘shish**da summa, sana, usul va mavjud kassa/bank hisobini tekshirib,
  alohida tasdiqlang. Ushbu amal real bank/Click transferini boshlamaydi;
  operator qabul qilingan to‘lovni qayd qiladi.
- **To‘lov tarixi** va o‘quvchining moliyaviy profilida yozuvlar hamda
  qaytarishlarni ko‘ring. Tarixdagi oy filtri to‘lov sanasi oyiga tegishli.
- **Qarzdorlar**da qarzlarni tekshiring. Billingdagi tanlangan oy qarzi bilan
  barcha oylar bo‘yicha umumiy qarzni adashtirmang.
- Chegirma/hisobni tuzatish va to‘lovni qaytarish mavjud biznes egasi
  huquqlari, sabab va audit tartibida qoladi. Yaratish tugmasi bu amallarni
  bajarmaydi. To‘lov retry uchun mavjud idempotency himoyasi saqlangan.

## Biznes egasi o‘qituvchi maosh qoralamalarini qanday yaratadi?

1. **Biznes egasi** sifatida maosh ekraniga kiring. Administrator bu
   operatsiya va automation statusini ko‘rish huquqiga ega emas.
2. **Oy** maydonida tugagan oyni tanlang. Oy yopilishi **Asia/Tashkent** bo‘yicha
   tekshiriladi; joriy tugamagan yoki kelajak oy rad etiladi.
3. **Oylik qoralamalarni yaratish** tugmasini bosing. Tugmani bosish qo‘lda
   boshlash harakatidir; so‘rov `confirmed: true` yuboradi.
4. **Holatni yangilash**, o‘qituvchi natijalari va kerak bo‘lsa keyingi natija
   sahifalari orqali holatni tekshiring. UI 10 tadan o‘qituvchi batchlarini
   `afterTeacher` bo‘yicha davom ettiradi. Bu amal o‘qituvchi filtriga emas,
   markazdagi barcha faol o‘qituvchilarga tegishli.
5. **Tekshirish kerak** natijalarida xato kodi va izohni o‘qing.
   `NO_SALARY_RULE` yoki qamrab olinmagan guruh bo‘lsa **Maosh sozlamalari**da
   tegishli davr uchun qoidani tekshiring, keyin yaratishni qaytaring.
6. **Maoshni ko‘rish** orqali har bir qoralamaning o‘qituvchisi, davri,
   hisoblash asosi, foizi, summasi va avvalgi tuzatishlarini tekshiring.
7. Har bir maoshni **alohida tasdiqlang**. To‘lovni keyin alohida qayd eting.
   Qoralama yaratish maoshni avtomatik tasdiqlamaydi yoki to‘lamaydi.

Mavjud endpointlar: `POST /api/payroll/automation/run` va
`GET /api/payroll/automation/status?month=YYYY-MM`. Ular owner sessiyasi bilan
ishlaydi; payroll scheduler secretiga bog‘liq emas. Tugamagan oy uchun server
`409 PAYROLL_MONTH_OPEN` qaytaradi.

`collected` — qaytarilmagan qabul qilingan to‘lovlar; `billed` — chegirma va
proratsiyadan keyingi haqiqiy hisoblar; `fixed` — mavjud belgilangan maosh
qoidalari bo‘yicha ishlaydi. Guruh/umumiy qoidalar va mavjud payroll engine
saqlangan. Qoidasi yo‘q o‘qituvchi uchun sun’iy nol maosh yaratilmaydi,
operatorga istisno ko‘rsatiladi. Oldin yaratilgan qoralama, tuzatish,
tasdiqlangan maosh, to‘lov va audit qayta yozilmaydi. Qoidani o‘zgartirish
mavjud payrollni ushbu tugma orqali qayta hisoblamaydi.

## Secretsiz nimalar avtomatik qoladi?

Foydalanuvchi boshlagan operatsiya ichidagi avtomatik hisoblashlar qoladi:

- O‘quvchini guruhga qabul qilishda preview tasdig‘idan so‘ng birinchi oy
  proratsiyali hisob tranzaksiyada yaratiladi.
- To‘lov yoki qaytarish qayd etilgach qoldiq va qarz tegishli yozuvlar asosida
  yangilanadi; bu tashqi schedulerga bog‘liq emas.
- Qo‘lda payroll yaratishda mavjud engine hisoblaydi, audit va run holatlarini
  saqlaydi. Tegishli shartlarda bildirishnoma navbatga qo‘yilishi mumkin;
  navbatga yozilish xabar yuborildi degani emas.

Serverdagi mavjud production monitoring taymeri diagnostika va mavjud sozlamalar
bo‘yicha operator ogohlantirishlari uchundir; u billing/payroll yoki notification
queue ishlovchisini ishga tushirmaydi. Yangi ichki job yoqilmadi. Telegram webhook
va alohida notification/CLI imkoniyatlari o‘z konfiguratsiyasiga bog‘liq; scheduler
secretlari yo‘qligi barcha boshqa tashqi integratsiyalarni o‘chiradigan umumiy
bayroq emas. Ushbu ish doirasida tashqi xabar yuborilmadi.

## Qaysi schedulerlar o‘chirilgan va nimalar tekshirilmadi?

Uchala secret yo‘q bo‘lgan tekshirilgan konfiguratsiyada quyidagi machine
endpointlar `503 SCHEDULER_DISABLED` qaytardi, hatto CRM sessiyasi yoki taxminiy
Bearer berilganda ham:

- `POST /api/internal/billing/run`
- `POST /api/internal/payroll/run`
- `POST /api/internal/notifications/run`

Secret sozlangan konfiguratsiya uchun Bearer talabi saqlanadi: yetishmagan yoki
noto‘g‘ri Bearer `401` qaytaradi. CRM cookie/query parametri machine ruxsatini
almashtirmaydi. Hech qanday fallback parol yoki ochiq cron route qo‘shilmadi.

GitHub read-only tekshiruvida ikki scheduler workflow holati **active**:

| Workflow | Vaqt | Ishni boshlash sharti |
| --- | --- | --- |
| `.github/workflows/tuition-billing.yml` | `5 19 * * *` UTC, Toshkentda 00:05 | `vars.BILLING_SCHEDULER_URL != ''` |
| `.github/workflows/payroll-monthly.yml` | `*/15 * * * *` UTC | `vars.PAYROLL_SCHEDULER_URL != ''` |

Demak URL variable avvaldan to‘ldirilgan bo‘lsa, scheduled job avtomatik
boshlanishi mumkin. Ishlovchi HTTPS exact path va tegishli GitHub secretini talab
qiladi; API ham alohida o‘z secretini tekshiradi. `workflow_dispatch` ham mavjud,
lekin bu tekshiruvda chaqirilmadi.

Repo Actions variables/secrets metama’lumotlarini o‘qish GitHub integration
ruxsati sabab **403** qaytardi. URL qiymatlari va GitHub/production secretlari
mavjudligi tasdiqlanmadi. Ko‘rilgan oxirgi 12 scheduled running barchasi `skipped`;
jumladan [billing](https://github.com/eagleabror/softlans-edu/actions/runs/42531978949)
va [payroll](https://github.com/eagleabror/softlans-edu/actions/runs/42595968553).
Bu kuzatuv doimiy o‘chirilganlik kafolati emas. Operatorning tegishli read-only
ruxsati bilan URL variable holatini tasdiqlashi ochiq cheklov bo‘lib qoladi.
Notification uchun repoda GitHub scheduler workflow yo‘q; tashqi cron provayderi
va production runtime sozlamalari bu ishda tekshirilmagan.

Qo‘lda rejim uchun scheduler secretlarini yaratish shart emas. Sozlamada ular
bo‘lmasin; bo‘sh satr bilan to‘ldirish valid secret hisoblanmaydi. Bu hujjat
production secretlarini o‘zgartirishga ko‘rsatma emas. `JWT_SECRET`,
`MONGODB_URI`, aniq `APP_ORIGIN`, MongoDB replica set, xavfsiz sessiya va
mavjud MFA sozlamalari zarur bo‘lib qoladi. JWT/MFA/RBAC/CSRF/subscription va
markazlararo ajratish o‘zgarmagan.

## O‘zgarish va tekshiruv dalillari

Aniqlangan yagona mahsulot tuzatishi: billing UI umumiy muvaffaqiyat xabari
o‘rniga server tasdiqlagan oy, yaratilgan va o‘tkazib yuborilgan sonlarni
ko‘rsatadi. Xato yoki tasdiqlanmagan javob uchun muvaffaqiyat sanog‘i berilmaydi.
Dialog matni qo‘lda amal ekanini tushuntiradi. Mavjud pilot fixturedagi sanaga
bog‘liq test xatosi qaytarish vaqtini hisobot davriga mahkamlash bilan tuzatildi.
Backend, hisoblash, workflow, security va payroll UI o‘zgarmagan.

`apps/api/tests/manual-financial-mode.test.ts` faqat yangi loopback
`MongoMemoryReplSet` ishlatadi, uchala secretni bermaydi va tashqi fetchni
bloklaydi. U enrollment/proratsiya, keyingi oy billing, retry, qisman/to‘liq
to‘lov, qarz, maosh usullari, qoidasi yo‘q ustoz, approve/payout ajratilishi,
audit/tuzatishlarni saqlash, admin/owner, tenant, CSRF, MFA va revoked session,
uchta disabled scheduler holatini tekshiradi. Mavjud billing/payroll/MFA testlari
boshqa hisoblash chegaralari va himoyalarni ham tekshiradi.

Yakuniy natijalar: `npm test` — API 40 faylda **580 passed, 1 skipped**;
web 25 faylda **138 passed**. Jami **718 passed, 1 skipped**. Skip mavjud
`DR_DRILL_CONFIRM=synthetic-only` bilan alohida yoqiladigan native recovery drillga
tegishli; bu muhitda `mongodump`/`mongorestore` o‘rnatilmagan. `npm run typecheck`
va `npm run build` o‘tdi; buildda mavjud >500 kB chunk ogohlantirishi bor.
`npm audit` va `npm audit --omit=dev` — har birida **0 zaiflik**.
Secretsiz manual billing acceptance — **PASS**. Secretsiz manual payroll
acceptance — **PASS**. Bu natijalar faqat sintetik muhitga tegishli.

Aniq ishga tushirish natijalari va desktop/mobile screenshotlar:
[`artifacts/phase-6-5-4`](../artifacts/phase-6-5-4/).
Browser haqiqiy mahalliy API va sintetik bazada 1 hisob yaratdi; qayta bajarishda
0 yaratildi, 1 o‘tkazib yuborildi. Majburiy checkbox, native dialog, konsol xatolari
va 320–1440 px o‘lchamlarda sahifa overflowi tekshirildi. Dizayn yangilanmadi.

Production moliyaviy yozuvi, scheduler aktivatsiyasi, secret o‘zgarishi,
avtomatik merge/deploy yoki pullik resurs ishlatilmadi. **Production backup
kechiktirilgan. Real mijoz moliyaviy piloti — NO-GO.** Sintetik testlarning
o‘tishi production readiness yoki haqiqiy mijoz piloti uchun ruxsat bermaydi.
