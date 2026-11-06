# MongoDB zaxira siyosati — operator loyihasi

Holat: **taklif; jonli sozlamalar tekshirilmagan va hech narsa yoqilmagan**.
Owner xarajat va retentionni, DB mas’uli izchillik va tiklashni, xizmat operatori
monitoring va kirishni tasdiqlaydi. Production ma’lumotini eksport qilish uchun
alohida yozma ruxsat kerak. Ushbu repo production backup jobini o‘rnatmaydi.

## Variantlar

| Variant | Tarif bo‘yicha mavjudlik | Taxminiy xarajat modeli | Retention va cheklov |
| --- | --- | --- | --- |
| A: Atlas Cloud Backup snapshot | Odatda dedicated M10+; M0 Free’da managed backup yo‘q. Flex’da alohida cheklangan kunlik snapshot siyosati bor; dedicated siyosat bilan teng emas. Eski M2/M5 nomlarini amaldagi tarif deb qabul qilmang. | M10+ compute narxi, backup GB-oy, qo‘shimcha nusxalar, restore/regionlararo transfer va vaqtinchalik restore klasteri; Flex narx tarkibini alohida tekshiring. | Dedicated’da soatlik/kunlik/haftalik/oylik siyosat va tarif/provider chegaralari; Flex’da odatda oxirgi 8 kunlik snapshot. Aniq muddatni Dashboardda tasdiqlang. Snapshotlar orasidagi yozuv yo‘qolishi mumkin. |
| B: Atlas uzluksiz backup/PITR | Mos dedicated M10+ va Cloud Backup talab qilinadi; haqiqiy tier/provider/region mosligini tekshiring. M0/Flex uchun PITR deb rejalashtirmang. | A xarajatlari + oplog saqlash/replay, PITR oynasi va restore compute/transfer. Yangi pullik imkoniyatni owner ruxsatisiz yoqmang. | Sozlangan restore oynasi ichida snapshot + oplog orqali tanlangan vaqt; eng yangi restorable vaqt hozirgi vaqtdan ortda qolishi mumkin. Oynadan oldingi hodisani tiklamaydi. |
| C: shifrlangan `mongodump` fallback | Database Tools va read huquqi bor muhitlar; M0/Flex’da command va oplog cheklovlarini tekshiring. | Vosita bepul; worker vaqti, object storage GB-oy, KMS, request, transfer, test restore compute va operator vaqti alohida. | Taklif: 7 kunlik, 4 haftalik, 3 oylik avlod. Faqat owner tasdiqlagan storage/retention; jonli schedule yaratilmagan. PITR o‘rnini bosmaydi. |

Aniq oylik USD summasi berilmagan: region, provider, haqiqiy tier, saqlanadigan
hajm, o‘zgarish tezligi va transfer noma’lum. Owner kalkulyatorda smeta tuzsin:
compute + snapshot hajmi × GB-oy narxi + oplog + qo‘shimcha nusxa + test compute
+ transfer + KMS. Masalan, 10 GB × 7 to‘liq logical avlod — siqishsiz 70 GB;
snapshotlar inkremental bo‘lishi mumkin, bu hisob ularga narx prognozi emas.
Tasdiqlash sanasi, valyuta, narx manbasi va budjet chegarasi qayd etilsin.

## Izchillik, shifrlash va huquqlar

- A/B: Atlas boshqaradigan snapshot va oplog izchilligi imkoniyatidan foydalaning;
  topology va restore versiyasi cheklovini tekshiring. Snapshot tashqi to‘lov
  provayderi yoki Telegram bilan atomik holat bermaydi. Atlas disk/snapshot
  shifrlashi va TLSni tasdiqlang; customer-managed key ishlatilsa KMSga favqulodda
  kirish ham tekshirilsin. Kalitni yo‘qotish backupni yaroqsiz qiladi.
- A/B: ilova DB useriga Atlas backup boshqaruvini bermang. Alohida operatorga
  loyihada faqat backup ko‘rish, kerak bo‘lganda alohida restore huquqi; owner va
  billing boshqaruvi ajratilsin. Aniq mavjud Atlas rollarini tekshirib minimalini
  tanlang, auditorni deploy/DB yozish huquqi bilan birlashtirmang.
- C: bir DBga scoped `read` va kerakli metadata huquqlari; root/readWrite bermang.
  `--oplog` bilan to‘liq replica-set dump alohida backup roli va oplog o‘qishini
  talab qilishi mumkin. `--oplog`ni `--db` bilan izchil DB snapshot deb tasvirlamang.
  Parallel yozuvdagi oddiy dump kolleksiyalararo bir vaqt nuqtasi emas. Fallback
  uchun yozuvlarni nazoratli to‘xtatish yoki mos to‘liq oplog usulini alohida
  stagingda isbotlash shart. Quiescent sintetik drill bu masalani isbotlamaydi.
- C: stdoutni darhol tasdiqlangan authenticated encryption oqimiga uzating;
  ochiq dumpni disk, log, Git yoki CI artifactga yozmang. Keyni dump bilan saqlamang.
  Production fallback kodi bu fazada berilmagan. Test harness 16 MiB xotira
  chegarali va faqat mayda sintetik ma’lumotga mos.
- Restore uchun yangi izolyatsiyalangan klasterda vaqtinchalik yozish/index yaratish
  huquqi; backup useriga restore huquqi kerak emas. Sirlar secret store yoki
  lokal test env orqali, URI/kalit CLI tarixi, chat, PR yoki logga chiqarilmasin.
- Storage Renderning ephemeral diskida yoki yagona developer laptopida qolmasin.
  Alohida hisob/bucket, minimal IAM, audit, delete protection/immutability va
  ilova adminidan ajratilgan kirish tavsiya etiladi. Atlas snapshot projectiga
  kirish yo‘qolishiga qarshi alohida boshqaruv recovery yo‘li kerak; cross-region
  copy alohida haq va ruxsat talab qilishi mumkin.

## Maqsad va nazorat

**Pilot RPO ≤24 soat, RTO ≤4 soat — tasdiqlanmagan maqsadlar.** RPO hodisagacha
eng ko‘pi 24 soatlik tasdiqlangan yozuv yo‘qotilishini; RTO hodisa aniqlanganidan
xizmat tekshirilib qayta ochilguncha eng ko‘pi 4 soatni anglatadi. Bu zarar uchun
avtomatik biznes roziligi emas. Kunlik muvaffaqiyatli, izchil backup zarur;
tugash kechikishi va bitta job xatosi uchun zaxira bilan 12 soatlik intervalni
baholang. Eng yangi tekshirilgan recovery point 24 soatga yaqinlashsa eskalatsiya
qiling; 24 soatdan oshsa RPO buzilgan deb qayd eting. Job started/finished,
backup recovery timestamp, hajm, checksum/authentication va xatolarni kuzating.

Qattiqroq RPO uchun tez-tez snapshot yoki mos PITR/oplog, kichik lag alerti,
yozuv/restore throughput va ko‘proq budjet kerak. RTO uchun oldindan tayyorlangan
kirish, klaster capacity, secret/network tiklash, mos binary va mashq zarur.

Operator kunlik job/snapshot completionni, haftalik artifact/kalit mavjudligini,
oylik izolyatsiyalangan restore drillni va har riskli migration oldidan yangi
recovery pointni tekshirsin. Oxirgi backup muvaffaqiyatli bo‘lishi uning
restore qilinishini kafolatlamaydi. A/Bda restorable range va restore target;
Cda checksum + authenticated decryption + to‘liq restore tekshirilsin.

RPOni hodisa va eng yangi **tekshirilgan izchil recovery point** orasida o‘lchang;
RTOni aniqlash, tasdiqlash, provisioning, decrypt/restore, indeks, ilova smoke va
qayta ochish vaqtlarini qo‘shib o‘lchang. Natijalar real hajmli, ruxsat etilgan
izolyatsiyalangan drill dalili bo‘lmaguncha unverified bo‘lib qoladi.

## Operator tasdig‘i

- [ ] Atlas project/cluster ID, amaldagi tier/region va MongoDB versiyasini sirlarni chiqarmasdan qayd eting.
- [ ] A/B/C, xarajat, RPO/RTO, retention, ma’lumot joylashuvi va mas’ulni yozma tasdiqlang.
- [ ] Haqiqiy schedule, completed snapshot, PITR oynasi, IAM, MFA, TLS va KMSni tekshiring.
- [ ] Alohida restore klasteri, outbound bloklash va favqulodda kirishni tayyorlang.
- [ ] Ruxsat etilgan isolated restore dalili va actual RPO/RTOni qayd eting.
- [ ] Shundan keyingina production readiness bo‘yicha alohida qaror qiling.

Manbalar (operator amaldagi tarif/narxni qayta tekshiradi):
[Cloud Backup](https://www.mongodb.com/docs/atlas/backup/cloud-backup/),
[PITR](https://www.mongodb.com/docs/atlas/backup/cloud-backup/restore-continuous/),
[Flex backup](https://www.mongodb.com/docs/atlas/backup/flex/),
[mongodump](https://www.mongodb.com/docs/database-tools/mongodump/),
[Atlas narxlari](https://www.mongodb.com/pricing).
