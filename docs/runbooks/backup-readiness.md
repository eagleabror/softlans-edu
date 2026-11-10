# Production backup readiness — dalillar reyestri

2026-11-10: **NOT READY / tekshirilmagan**. Sintetik CI muvaffaqiyati production
backup mavjudligini yoki tiklanishini isbotlamaydi. Quyidagi kataklar real dalil
olinmaguncha ochiq qoladi. URI, kalit, token yoki mijoz hujjatini reyestrga kiritmang.
Backup/real restore uchun egasining **alohida roziligi** kerak; bu checklist
ruxsat bermaydi. Hech qanday pullik servis yoki production schedule yoqilmagan.

| Tayyorlik sharti | Talab qilinadigan dalil (ID/link, UTC vaqt, tekshiruvchi) | Holat |
| --- | --- | --- |
| DB identifikatsiyasi | Cluster/project xavfsiz ID, tier/region/version/topology; deployed app SHA | Tekshirilmagan |
| Backup usuli/izchillik | [Siyosat](backup-policy.md)dagi A/B/C tanlovi; snapshot yoki oplog/PITR; parallel yozuv consistency dalili | Tekshirilmagan |
| Schedule va oxirgi muvaffaqiyat | Job/snapshot ID, start/finish, recovery timestamp va failure/staleness alert sinovi | Tekshirilmagan |
| Offsite va access separation | Render ephemeral diskidan tashqaridagi storage, alohida IAM/admin chegarasi, account recovery | Tekshirilmagan |
| Retention va o‘chirishdan himoya | Owner tasdiqlagan kunlik/haftalik/oylik muddat; lifecycle amalda; delete protection/immutability qarori | Tekshirilmagan |
| Encryption va key recovery | TLS, at-rest/authenticated encryption, key store/KMS ID, alohida saqlash va break-glass mashqi | Tekshirilmagan |
| Minimal huquq va audit | Backup read/metadata, restore alohida target writer; MFA, ikkinchi operator; backup/storage access audit | Tekshirilmagan |
| Ruxsatli restore tekshiruvi | Yangi non-production target, outbound blok, kalit/auth, indeks/BSON/ledger, ikki tenant/RBAC, login/readiness | Tekshirilmagan |
| RPO | Pilot taklif **≤24 soat**, owner roziligi va actual restorable timestamp dalili | Tasdiqlanmagan |
| RTO | Pilot taklif **≤4 soat**, representative hajmdagi end-to-end drill va operator kirishi | Tasdiqlanmagan |
| Cutover/reconciliation | Backupdan keyingi valid to‘lovlar, eski sessiya/job replay, bank/Telegram tashqi hodisalari rejasi | Tekshirilmagan |
| Narx va mas’ullar | Budjet/retention roziligi, DB mas’uli, incident rahbari, alert receiver va navbatchi | Tasdiqlanmagan |

RPO = hodisa va eng yangi **izchil, tiklanishi tekshirilgan** recovery point
orasidagi vaqt. Backup tugagan vaqt recovery point bilan bir xil bo‘lmasligi mumkin.
RTO = incident aniqlanishidan access/approval/provisioning/decrypt/restore,
reconciliation, smoke va xizmatni qayta ochishgacha jami vaqt. Lokal fixture
testining millisekundlari bu talablarni tasdiqlamaydi. Asia/Tashkent operatsion
vaqti bilan birga dalil UTC vaqtini ham saqlang.

Taklif qilingan monitoring: operator kunlik completion/recovery-point yoshi,
haftalik storage/key access va oylik ruxsatli isolated restore natijasini tekshiradi.
12 soatlik backup intervalini baholash 24 soatlik RPO uchun kechikish zaxirasini
beradi; yangi pullik intervalni ruxsatsiz yoqmang. 24 soatdan eski recovery point
RPO buzilishi sifatida eskalatsiya qilinadi. Failed job qayta urinish bilan eski
muvaffaqiyatsizlikni yashirmasin; har ikkala natija saqlansin.

Har band uchun to‘ldiriladigan yozuv:

```text
Tekshiruv sanasi (UTC):
Tekshiruvchi / mas’ul:
Owner ruxsati havolasi va doirasi:
Backup/recovery point ID (secret emas):
Dalil manzili (cheklangan operator joyi):
Natija va qolgan istisno:
Keyingi tekshiruv sanasi:
```

Phase B’ni yoqish gate’i: yuqoridagi shartlar owner/DB mas’uli tomonidan
tasdiqlangan, real restore dalili bor va RPO/RTO bo‘yicha qaror qayd etilgan bo‘lsin.
Bu PR gate’ni avtomatik ochmaydi. Restore tartibi:
[database-restore.md](database-restore.md); xavfsiz CI dalili:
[Phase A](../phase-a-backup-readiness.md).
