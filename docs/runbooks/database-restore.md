# Xavfsiz MongoDB tiklash

**Production ustiga restore qilmang. Yangi valid yozuvlarni eski backup bilan
ko‘r-ko‘rona almashtirmang. Render rollback MongoDBni tiklamaydi.**

## Mahalliy sintetik mashq

Talablar: Node 22.12+, `npm ci`, MongoDB Database Tools (`mongodump`,
`mongorestore`) PATHda, MongoMemoryReplSet uchun MongoDB 7.0.24 binarysi.
Sinovdagi vosita: 100.14.0. Ishonchli MongoDB manbasidan mos OS paketini oling,
versiya va yetkazib beruvchi checksum/signaturasini o‘z jarayoningizda tekshiring.
Bu loyiha vositalarni yashirin yuklamaydi. Memory server binaryni keshga
olishi mumkin. Hech qanday production URI yoki secret kiritmang.

```sh
npm test
# Yuqoridagi buyruqda faqat recovery preflight/crypto testlari; drill o'tkazib yuboriladi.
npm run test:recovery
```

Ikkinchi buyruq `DR_DRILL_CONFIRM=synthetic-only` bilan haqiqiy lokal drillni
boshlaydi. U URI qabul qilmaydi: faqat o‘zi yaratgan ephemeral loopback replica
set, tasodifiy `dr_source_<32hex>` va `dr_restore_<32hex>` nomlarini ishlatadi.
Helper oddiy chaqirilganda dry-run; execute uchun targetga bog‘langan alohida
`RESTORE_SYNTHETIC:<target>` tasdig‘i shart. Empty/ambiguous/production nomlar,
masofaviy yoki credentialli URI, qo‘shimcha parametr va bo‘sh bo‘lmagan target
rad etiladi. `--drop` yo‘q; target boshqa yozuvchilar uchun ochilmasin.

Barcha fixturelar model validatsiyasi orqali yaratiladi. Debt alohida model
emas: 1000 charge – 400 payment = 600 qarz API orqali tekshiriladi. Ikki tenant,
owner/admin/teacher, o‘quvchi, guruh/a’zolik, xona/jadval, davomat, SaaS tarif,
subscription snapshot, payment request/audit, onboarding va o‘chirilgan Telegram
metadata mavjud. Qolgan bo‘sh kolleksiyalar ham dump/restore inventariga kiradi.

Native archive faqat xotirada (16 MiB limit) ochiq bo‘ladi. Diskdagi vaqtinchalik
fayl AES-256-GCM, mode 0600; har run uchun tasodifiy kalit faqat process xotirasida.
Butun ciphertext restore boshlanishidan oldin autentifikatsiyalanadi. Buzilgan
artifactda DB o‘zgarmasligi va takroriy restore rad etilishi tekshiriladi.
Finally cleanup replica set va faylni olib tashlaydi; process keskin uzilsa,
`/tmp/softlans-dr-*` qoldig‘ini operator tekshirib tozalasin. Backup artifactni
Git/CIga biriktirmang. Test helper deploy buildiga kirmaydi.

`server.ts` webhook/scheduler entrypointlari ishga tushmaydi; ilova configi
alohida quriladi, Telegram token/webhook/scheduler siri berilmaydi, fetch rad
etiladi va chaqirilmagani tekshiriladi. Tashqi scheduler ochilmaydi. Restore
qilingan bazada connect/replica-set/index startup ketma-ketligi, readiness,
parol bilan login, RBAC, cross-tenant 404 va moliyaviy API tekshiriladi.
Indeks va hujjatlar **startupdan oldin** tenglashtiriladi: startup ularni
qayta yaratib backup kamchiligini yashirmaydi. Alohida haqiqiy API processi ham minimal test env bilan start/readiness/SIGTERM
exit orqali tekshiriladi. Bu production frontend/deploy, concurrent write, oplog replay yoki infrastructure provisioning sinovi emas.

## Ruxsat etilgan haqiqiy izolyatsiyalangan tiklash

1. Incident rahbari va DB mas’uli hodisa vaqtini, ta’sir tenantlarini va eng
   yangi valid yozuvni qayd etsin. Hozirgi ma’lumotni saqlang; zarur bo‘lsa
   tasdiqlangan change orqali yozuvlar/workerlarni to‘xtating. Ruxsatsiz dump yo‘q.
2. Backup ID, recovery timestamp, versiya, retention, encryption/KMS va maxsus
   restore ruxsatini tekshiring. Backup/source va target identifikatorlarini ikki
   operator mustaqil tekshirsin; target yangi non-production klaster bo‘lsin.
3. Real data ishlatilsa privacy/ruxsat, access va tozalash muddatini alohida
   tasdiqlang. Telegram/HTTP tashqi egressni network darajasida bloklang; token,
   webhook, cron, delivery va tashqi integratsiyalarni ishga tushirmang.
4. Atlas A/Bda tasdiqlangan snapshot yoki hodisadan oldingi PITR vaqtini **yangi
   klasterga** tiklang. Fallback C faqat oldindan tasdiqlangan vosita, kalit va
   storage bilan, authenticated decryptiondan keyin bo‘sh targetga; ushbu test
   helperini production backup uchun ishlatmang. URIni CLI/logga chiqarmang.
5. Kolleksiyalar/count, BSON qiymatlar, unique/partial/TTL indekslar, tenantId va
   barcha reference ownershipni tekshiring. TTL eskirgan metadata olib tashlashi
   mumkin; farqni sabab bilan hujjatlashtiring, moliyaviy farqni oddiy TTL deb yopmang.
6. Charge/payment/reversal/adjustment, payroll/payout, debt va subscription
   snapshot/TrialGrant/payment-request/audit idempotencylarini solishtiring.
   Amaldagi tarifdan eski subscriptionni qayta hisoblamang. Narx/trialni o‘zgartirmang.
7. Mos ilova commitida startup/readiness, har rol login/RBAC va ikki tenant
   izolyatsiyasini tekshiring. Eski token/sessiya/link/joblar qaytishi mumkin:
   sessiya bekor qilish va notification dedup/replay rejasi alohida tasdiqlansin.
   Tashqi bank/Telegram hodisalari DB bilan atomik emas, avtomatik qayta yubormang.
8. Backupdan keyingi valid yozuvlarni saqlab qoluvchi reconciliation rejasini
   tuzing. Original DBni yo‘q qilmang. Selective repair yoki cutover diffi, customer
   ta’siri, cutover va qaytish rejasi owner tomonidan tasdiqlanmaguncha to‘xtang.
9. Faqat alohida ruxsat bilan ulanishni almashtirish; smoke, log va hisoblarni
   tekshirishdan keyin yozuvlarni ochish. RTO/RPO, qarorlar va dalillarni qayd
   etish; vaqtinchalik credentials va restore data retentionini bajarish.

To‘xtash shartlari: backup auth/checksum xatosi, noma’lum target, indeks konflikti,
ledger nomutanosibligi, tenant reference buzilishi, yetishmayotgan key yoki yangi
valid data ustiga yozish xavfi. DB mas’uli va incident rahbariga eskalatsiya qiling.
