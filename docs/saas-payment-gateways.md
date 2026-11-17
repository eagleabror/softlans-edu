# Payme va Click: platforma obunasi to‘lovlari

Bu integratsiya o‘quv markazining Softlans tarifini to‘lash uchun. O‘quvchi to‘lovlari va karta bog‘lash/avtomatik oylik yechish kirmaydi. Mavjud bank orqali to‘lov so‘rovi saqlanadi.

## Bir martalik server sozlamasi

`PAYMENT_CREDENTIALS_ENCRYPTION_KEY` — tasodifiy 32 baytli, 64 ta hex belgida ifodalangan server kaliti. Uni deployment secret sifatida bir marta o‘rnating. Masalan, operator xavfsiz terminalida `openssl rand -hex 32` bilan yaratishi mumkin. JWT yoki MFA kalitini qayta ishlatmang. Kalitni source, chat yoki logga yozmang.

Keyinchalik merchant rekvizitlari **Super Admin → To‘lov tizimlari** (`/super-admin/payment-providers`) orqali kiritiladi; kodni o‘zgartirish/redeploy kerak emas. Provayder maxfiy kalitlari MongoDB’da AES-256-GCM bilan shifrlanadi. Har bir shifrlashda yangi nonce ishlatiladi; AAD provayder, muhit va yozuv ID’sini bog‘laydi. GET API hech qachon secret yoki ciphertext qaytarmaydi.

Shifrlash kalitini bazadan alohida, xavfsiz backup qiling. Uni yo‘qotish saqlangan merchant kalitlarini o‘qishni imkonsiz qiladi. Master kalitni shunchaki almashtirish rotatsiya emas: mavjud ciphertext qayta shifrlanishi yoki merchant rekvizitlari qayta kiritilishi kerak. Master-key rotatsiyasi uchun avtomatik migratsiya bu versiyaga kirmaydi.

## Provayderlarni sozlash

Payme: kassa/Merchant ID, callback Basic Auth login’i (standart `Paycom`, provayder bergan qiymatni tekshiring), maxfiy kalit. Click: Merchant ID, Service ID, Secret Key.

Test va production yozuvlari alohida. Har biri default o‘chirilgan. Click test rekvizitlari provayder tomonidan test uchun berilgan bo‘lishi kerak: ilovadagi “Test” belgisi oddiy production service’ni sandboxga aylantirmaydi. Click to‘lov havolasi provayderning `my.click.uz` sahifasiga boradi; haqiqiy pul yechilmasligi merchant/service provisioning’iga bog‘liq. Test yozuvi Softlans haqiqiy obunasini hech qachon uzaytirmaydi va daromad hisobotiga kirmaydi.

Panel callback URL’ni ko‘rsatadi:

- `/api/integrations/payme/test` yoki `/api/integrations/payme/production`
- `/api/integrations/click/test` yoki `/api/integrations/click/production` — Prepare va Complete uchun ayni manzil, `action` bo‘yicha ajratiladi.

Payme hisob maydoni `account.order_id`, Click `merchant_trans_id` — oldindan yaratilgan buyurtma ID’si. Callback manzilini tegishli provayder kabinetiga kiriting. `APP_ORIGIN` tashqi HTTPS domen bo‘lishi kerak. Uzluksiz ishlaydigan, provayder vaqt cheklovlariga javob beradigan server talab etiladi; uxlab qoladigan xizmatda cold-start kechikishini production oldidan bartaraf qiling.

Saqlash uchun joriy parol va MFA yoqilgan bo‘lsa kod kerak. Bo‘sh yangi kalit maydoni avvalgi kalitni saqlaydi. “Saqlangan” yoki “Yoqilgan” holati provayder tomonidan tekshirilganini bildirmaydi. Oxirgi autentifikatsiyalangan callback va xato kodi panelda ko‘rinadi.

Merchant yoki service ID buyurtmada ishlatilganidan keyin almashtirilmaydi. Secret’ni provayder kabineti bilan muvofiqlashtirib almashtiring: yangi kalit darhol ishlatiladi, eski kalit qabul qilinmaydi. Aktiv tranzaksiyalar ID va tarixi saqlanadi. Provayderni o‘chirish yangi buyurtma/havolalarni to‘xtatadi; mavjud buyurtmalarning callbacklari, refund va hisobotlari ishlashda davom etadi. Shuning uchun bu tugma provayderga oldin berilgan havolani bekor qilish yoki buzilgan kalitni revoke qilish o‘rnini bosmaydi.

## Oqim va API

Egaga `GET /api/saas/payment-providers` faqat tayyor production provayder nomlarini beradi. `POST /api/saas/payment-orders` tanlangan `planId`, `billingPeriod` (1–12), `provider`, UUID `idempotencyKey` oladi. Tenant va foydalanuvchi sessiyadan olinadi; narx serverda hisoblanadi. Natija `{ order, checkoutUrl }`; foydalanuvchi yakuniy summani ko‘rib, alohida havola orqali to‘laydi. Shu kalitni boshqa mazmun bilan yuborish 409 qaytaradi.

`GET /api/saas/payment-orders` sahifalangan tarix, `GET /api/saas/payment-orders/:id` holat va mavjud bo‘lsa davom ettirish havolasini beradi. Qaytish URL’idagi `paymentOrder` faqat shu himoyalangan GET uchun identifikator; muvaffaqiyat belgisi emas. Interfeys 1 daqiqagacha har 5 soniyada tekshiradi, keyin qo‘lda yangilash mumkin.

Super Admin API:

- `GET /api/super-admin/saas/payment-providers`
- `PATCH /api/super-admin/saas/payment-providers/:provider/:environment`: rekvizitlar, `enabled`, joriy `revision`, `password`, ixtiyoriy MFA `code`.
- `POST /api/super-admin/saas/payment-orders/test`: odatdagi buyurtma maydonlariga test `tenantId` qo‘shiladi.
- `GET /api/super-admin/saas/online-payments`: `page`, `environment`, `status`, `tenantId` filtrlari.
- `GET /api/super-admin/saas/online-payments/:id`: to‘lov, joriy obuna, o‘zgarishdan oldingi/keyingi nusxalar va tenant revision’i.
- `POST /api/super-admin/saas/online-payments/:id/refund`: pastdagi muvofiqlashtirish amali.

Payme Merchant API: CheckPerformTransaction, CreateTransaction, PerformTransaction, CancelTransaction, CheckTransaction va GetStatement. HTTP 200 JSON-RPC natija/xatolari qaytariladi. Summalar provayderga tiyinlarda beriladi. Payme yaratilgan tranzaksiyasining 12 soatlik timeout’i qayta chaqirishda server tomonidan tekshiriladi. GetStatement original Payme `time` bo‘yicha, inklyuziv oraliqda barcha muvaffaqiyatli yaratilgan tranzaksiyalarni beradi.

Click Shop API: form yoki JSON Prepare/Complete, MD5 `sign_string`, service/order/amount/prepare ID mosligi. Pul satri aniq tiyingacha parse qilinadi, float yaxlitlash ishlatilmaydi. Takroriy Prepare bir xil raqam qaytaradi; takroriy Complete `Already paid` (-4) qaytarib, obunani takror uzaytirmaydi. Tayyorlangan Click tranzaksiyasining kechikkan muvaffaqiyatli Complete’i havola muddati tugashi sabab yo‘qotilmaydi. Complete paytida pul allaqachon yechilgan: obuna shartlari orada o‘zgarsa, to‘lov `paid` va `needsReview` sifatida audit bilan qayd etilib, muvaffaqiyat javobi beriladi; obuna o‘zgartirilmaydi. Operator Click kabinetida to‘liq reversal bajarib, panelda muvofiqlashtiradi. Bu operator navbatini production’da muntazam kuzatish kerak.

Provayder javobini tasdiqlash, obuna va audit MongoDB replica-set tranzaksiyasida yoziladi. Tenant revision’i qo‘lda tasdiqlash va boshqa obuna amallari bilan parallel bajarilishni serializatsiya qiladi. To‘lov shartlari completion paytida yana tekshiriladi. Callback ishlayotganda subscription/merchant o‘zgarishi bilan write conflict bo‘lsa MongoDB transaction qayta urinadi. Noma’lum natijada yangi to‘lov o‘rniga shu buyurtma holatini tekshiring.

Faol tarif kelishilgan shartlarda uzayadi. Boshqa tarifga faqat pullik davr tugagach o‘tiladi. Trial yoki tugagan obuna to‘lov vaqtida yangi pullik davrni boshlaydi. `suspended`/`cancelled` obuna uchun avval admin boshqaruvi kerak. To‘lov tenantning ma’muriy blokini o‘chirmaydi.

## Refund va reconciliation

Bu versiyada faqat to‘liq refund. Super Admin avval provayder kabinetida pul qaytaradi. Payme CancelTransaction callback’i paid buyurtmani `refunded` qiladi; obuna avtomatik eski snapshotga qaytarilmaydi, chunki undan keyin boshqa to‘lovlar bo‘lishi mumkin.

Click Shop API refund tasdig‘i alohida shu oqimda kelmagani uchun Super Admin provayder kabinetini tekshirib, qaytarish raqamini kiritadi. Ilova provayder nomidan pul qaytarish API chaqirig‘ini yubormaydi.

**Onlayn to‘lovlar → Tafsilotlar** oynasida admin qaytarish raqami, sabab, yangi tugash sanasi, tekshiruv tasdig‘i, parol va kerak bo‘lsa MFA kodini beradi. Payme uchun avval `refunded` callback kelishi shart. Yangi sana joriy obuna boshlanishi va tugashi orasida bo‘ladi; muddatni uzaytirib bo‘lmaydi. Keyingi to‘lov/admin amali revision’ni o‘zgartirsa, tuzatish rad etilib, qayta ko‘rib chiqish talab qilinadi. Bir buyurtmaning tuzatishi faqat bir marta bajariladi. `suspended`/`cancelled` ma’muriy holatlar saqlanadi. Tuzatishgacha avvalgi kirish muddati saqlanadi, admin tarixida esa “Obuna tuzatishi kutilmoqda” ko‘rinadi.

## Ishga tushirish va tekshirish

Yangi kolleksiyalar `SaasPaymentProvider`, `SaasPaymentOrder`, `SaasGatewayTransaction`; indekslar mavjud `ensureIndexes()` orqali yaratiladi. Eski to‘lov yoki obunalarni qayta yozish migratsiyasi yo‘q. Gateways sozlanmaguncha bank to‘lovi va eski CRM oqimi ishlaydi.

1. Provayder shartnomasi va test rekvizitlarini tayyorlang. Komissiya, chek/fiskalizatsiya talablari va qaytarish tartibini provayder bilan tasdiqlang. Bu versiya Payme `SetFiscalData`/fiskal tovar tafsilotlari yoki Click fiscal API’ni avtomatik jo‘natmaydi; merchant uchun ular talab qilinsa, production yoqilishidan oldin qo‘shimcha ulanish kerak.
2. Master key, backup va HTTPS callback manzillarini tayyorlang; MongoDB replica set va indekslarni tekshiring.
3. Panelda test rekvizitlarini saqlang. Test buyurtma bilan muvaffaqiyat, noto‘g‘ri summa, takroriy callback, bekor qilish va refundni provayder sinovida tekshiring.
4. Production rekvizitlarini panelga kiriting, nazoratli haqiqiy to‘lov/qaytarishni tekshiring, so‘ng markazlarga e’lon qiling.
5. Paneldagi callback xatolari, pending to‘lovlar va refund tuzatishlarini kuzating. Timeout/tarmoq uzilishida provayder kabineti va to‘lov ID orqali solishtiring. Avtomatik bank statement importi yoki tashqi alert xizmati bu versiyaga kirmaydi.

Mahalliy testlar hech qanday real merchant yoki production bazasiga ulanmaydi:

```sh
npm run test -w @softlans/api -- tests/payment-gateways.test.ts tests/saas.test.ts tests/mfa-security.test.ts
npm run test -w @softlans/web -- src/OnlinePayments.test.tsx src/Saas.test.tsx src/SaasAdmin.test.tsx
npm run typecheck
npm run build
git diff --check
```

Rasmiy manbalar: [Payme Merchant API](https://developer.help.paycom.uz/metody-merchant-api/), [Payme sandbox](https://developer.help.paycom.uz/pesochnitsa/), [Click hujjatlari](https://docs.click.uz/). Haqiqiy merchant rekvizitlari berilmagani uchun provayder certification va real to‘lov sinovi bu kod tekshiruvining o‘rniga bajarilgan deb hisoblanmaydi.
