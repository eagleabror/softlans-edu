# Incidentga javob berish

Har incidentda rahbar ownerni jalb qiladi, operator UTC vaqt jadvali va deploy
SHAni, DB mas’uli recovery point va data ta’sirini, aloqa mas’uli mijoz yangilanishini
yuritadi. Backup/restore/cutoverga alohida ruxsat qayd etiladi. Sirlar va PIIni
chatga yubormang. Noma’lum yoki yangi valid ma’lumot ustiga yozadigan recovery
qilinmaydi. [Tiklash](database-restore.md), [backup](backup-policy.md) va
[Render rollback](render-rollback.md) checklistlariga amal qiling.

## A — MongoDB vaqtincha ishlamayapti

- Belgilar: `/api/ready` 503, selection timeout, startup xatosi yoki DBga bog‘liq 5xx.
- Containment: operator deploy/migrationni pauza qiladi; rahbar ta’sir doirasini
  aniqlaydi. Timeoutni ko‘r-ko‘rona oshirmang, yangi bo‘sh DBga o‘tmang.
- DB mas’uli Atlas status, replica election, network/TLS, credential muddati,
  connection limit va diskni sirlarni ochmasdan tekshiradi. Operator Render
  restart/OOM va konfiguratsiya tarixini solishtiradi. Provider hodisasi bo‘lsa
  ticket ochadi. Faqat sabab aniqlangach ruxsat etilgan tuzatish/restart.
- Verify: readiness tiklanishi, sintetik login/read va ledger/query sog‘lomligi;
  UNKNOWN_OUTCOME notificationni avtomatik resend qilmang.
- Aloqa: vaqtinchalik uzilish, ta’sir funksiyalari va keyingi update vaqti;
  data yo‘qolgan deb dalilsiz aytmang. Failover noaniq, corruption yoki uzilish
  RTOga yaqinlashsa incident rahbari/DB mutaxassisi/providerga eskalatsiya.

## B — Tasodifiy data o‘chirilgan

- Belgilar: tenantdagi son kamayishi, audit/customer xabari, ledger reference yo‘q.
- Containment: rahbar tegishli yozuv/integratsiyalarni tasdiqlangan yo‘l bilan
  to‘xtatadi; operator hodisa va user vaqtini saqlaydi. DBni drop/reset qilmang.
- DB mas’uli oldingi snapshot/PITRni yangi isolated targetga tiklaydi. O‘chgan
  doira va backupdan keyingi valid yozuvlarni diff qiladi. Selective reconciliation
  rejasi, duplicate/idempotency va yangi to‘lovlar owner bilan tekshiriladi.
- Verify: tenant ownership, count/index, ledger/debt va subscription/audit;
  faqat ruxsat etilgan repair/cutoverdan keyin smoke va yozuvlarni ochish.
- Aloqa: qaysi davr/funksiya tekshirilayotgani, mumkin bo‘lgan data yo‘qotish
  va keyingi update. Backup yo‘q yoki diff ishonchsiz bo‘lsa to‘xtang va eskalatsiya;
  butun eski bazani amaldagi DB ustiga qo‘ymang.

## C — Noto‘g‘ri application deploy

- Belgilar: deploydan keyin 5xx/readiness/login regressiyasi, restart yoki frontend xatosi.
- Containment: operator keyingi deploylarni pauza qilib deploy ID/loglarni saqlaydi;
  xavfli yozuvlar bo‘lsa rahbar containment belgilaydi.
- Operator va DB mas’uli oldingi commitning yangi DBga mosligini tekshiradi;
  owner tasdig‘i bilan [kod rollback](render-rollback.md). MongoDB avtomatik
  orqaga qaytmaydi. Moslik bo‘lmasa forward fix/staging rejasi.
- Verify: readiness, auth, tenant smoke, commit va error baseline; notification
  holati. Aloqa: xizmat regressiyasi va tiklash jarayoni, asossiz ETA yo‘q.
- Ledger yoki migration ta’siri topilsa rollbackni to‘xtatib D ssenariyga o‘ting.

## D — Noto‘g‘ri database migration

- Belgilar: index conflict, schema xatosi, qiymat/reference o‘zgarishi, moliyaviy farq.
- Containment: rahbar migration va ta’sirli yozuvlarni to‘xtatadi; operator script
  SHA, bosqich, vaqt va xato logini saqlaydi. Destructive down migration ishlatmang.
- DB mas’uli asl holatni saqlab, oldingi recovery pointni isolated targetda
  tiklaydi; migrationdan keyingi valid yozuvlarni farqlaydi. Forward repair yoki
  reconciliationni stagingda sinaydi; owner aniq data ta’siriga ruxsat beradi.
- Verify: barcha tenant reference, unique indeks, ledger/reversal/adjustment,
  subscription snapshot, audit va old/yangi kod compatibility. Keyin ruxsatli cutover.
- Aloqa: ta’sir davri va tasdiqlangan data sifati muammosi. Recovery nuqtasi yo‘q,
  irreversible amal yoki ishonchsiz ledgerda mutaxassis/providerga eskalatsiya;
  productionda tajriba qilib ko‘rmang.

## E — Backup muvaffaqiyatsiz yoki buzilgan

- Belgilar: scheduled backup tugamagan, artifact yo‘q, decrypt/auth/checksum xatosi,
  restore/count/index mismatch yoki recovery point 24 soatdan eski.
- Containment: operator artifact va metadata/logni saqlaydi, retention rotation
  oxirgi valid avlodni o‘chirmasin; owner riskli releaseni pauza qiladi.
- DB mas’uli oldingi valid avlodni isolated restore qiladi, key/KMS/storage/IAM,
  capacity va job xatosini tekshiradi. Ruxsat bilan backupni qayta oladi;
  shifrlashni o‘chirib “tuzatmang”. Backup corrupt bo‘lsa original DBga restore yo‘q.
- Verify: decrypt yetarli emas — to‘liq restore va app invariants, actual RPO/RTO.
- Aloqa: ownerga protection gap va mumkin bo‘lgan RPO buzilishi; mijoz xabari
  ta’sirga qarab rahbar tomonidan. Valid avlod yoki kalit yo‘q bo‘lsa darhol eskalatsiya.

## F — Infratuzilmaga kirish yo‘qolgan

- Belgilar: Render/Atlas/GitHub/secret store/KMSga operator kira olmaydi; MFA,
  billing yoki hisob recovery muammosi.
- Containment: rahbar kirish yo‘qolishimi yoki account compromise ekanini ajratadi;
  gumonda security incident ochadi. Secretlarni repo/chatga ko‘chirib o‘tmang.
- Owner oldindan tasdiqlangan ikkinchi operator/break-glass MFA va provider
  ownership recovery yo‘lini ishlatadi; operator project/service ID va billing
  ownership dalilini providerga xavfsiz kanalda beradi. DB mas’uli backup/keyga
  mustaqil kirishni tekshiradi. Zarur rotation alohida ruxsat va reja bilan.
- Verify: minimal IAM/MFA/audit, deployed commit, backup/key availability, app
  readiness va ruxsatli isolated restore. Keng admin accessni doimiy qoldirmang.
- Aloqa: faqat tasdiqlangan ta’sir va keyingi update, account recovery sirlarisiz.
  Ikkinchi operator/key yo‘q yoki hisob egasi tasdiqlanmasa provider/securityga
  eskalatsiya; ruxsatsiz yangi servisga real data ko‘chirmang.

Har yopilishda actual RPO/RTO, customer ta’siri, qarorlar, vaqtlar va sabab
qayd etilsin. Rahbar postmortem va mas’ul/muddatli choralarni belgilasin;
backup siyosati, monitoring va runbook yangilansin. O‘lchanmagan recovery
kafolat deb e’lon qilinmasin.
