# 6.2 — Lead CRM va sotuv voronkasi

## Imkoniyatlar

Faqat Business Owner va Admin uchun lead yaratish, tahrirlash, server qidiruvi,
filtrlar, pagination, sana bo‘yicha saralash, mas’ul biriktirish va arxivlash
qo‘shildi. Lead, TrialLesson, FollowUp va LeadHistory tenantga tegishli alohida
MongoDB kolleksiyalarida saqlanadi. Leadlarni butunlay o‘chirish endpointi yo‘q.

Telefonlar mavjud Student normalizatori bilan tozalanadi; taqqoslashda boshlang‘ich
`+` belgisi hisobga olinmaydi. Telefon bo‘sh bo‘lishi mumkin. Bir xil ismli yoki
telefonsiz yozuvlar avtomatik birlashtirilmaydi. Dublikat ogohlantirishi mavjud;
bir telefon bir oilada ishlatilishi mumkinligi sababli lead yaratish bloklanmaydi.

## Sahifalar va ishlatish

- `/leads`: jadval, ism/telefon qidiruvi, status, manba, mas’ul, arxiv va tartib filtrlari.
- `/leads/new`, `/leads/:id/edit`: lead yaratish va tahrirlash.
- `/leads/pipeline`: joriy sahifadagi leadlar oltita bosqichda. Keyingi sahifa
  tugmalari orqali qolgan leadlar ko‘riladi. Mobil ekranda ustunlar bir qatorli
  ro‘yxatga tushadi. Kartadagi ism orqali profil ochiladi; statusni tanlash
  klaviatura va touch bilan ishlaydi. Drag-and-drop qo‘shilmagan.
- `/leads/:id`: mijoz ma’lumotlari, dublikatlar, mas’ul, status, rad etish sababi,
  arxiv tasdig‘i, sinov darslari, vazifalar, audit tarixi va konvertatsiya.
- `/trial-lessons`: sana/o‘qituvchi bo‘yicha sinovlar, yaratish, ko‘chirish, natija,
  bekor qilish. Tahrirlash ayni yozuvni yangilaydi, auditda amal va vaqti saqlanadi.
- `/follow-ups`: bugungi, kechikkan, kelgusi kunlardagi vazifalar; mas’ul filtri,
  bajarish va bekor qilish. Hech qanday avtomatik Telegram xabari yuborilmaydi.
- `/leads/analytics`: KPI, status taqsimoti va marketing manbalari.
- Asosiy dashboard: CRM uchun oltita haqiqiy MongoDB ko‘rsatkichi.

## Status qoidalari

| Joriy status | Ruxsat etilgan keyingi statuslar |
| --- | --- |
| `new` | `contacted`, `lost` |
| `contacted` | `trial_scheduled`, `converted`, `lost` |
| `trial_scheduled` | `contacted`, `trial_completed`, `lost` |
| `trial_completed` | `trial_scheduled`, `converted`, `lost` |
| `lost` | `new` |
| `converted` | Yakuniy; faqat arxivlash mumkin |

`lost` uchun bo‘sh bo‘lmagan sabab talab qilinadi. Har bir status o‘zgarishida
`statusChangedAt`, oldingi/yangi status, xodim va vaqt tarixga yoziladi.
`converted` oddiy status endpointi orqali o‘rnatilmaydi. Sinovlar va status
alohida boshqariladi: sinov yozuvi lead statusini yashirin o‘zgartirmaydi.

## Konvertatsiya tartibi

1. Lead bilan bog‘lanib, `contacted` yoki `trial_completed` bosqichiga o‘tkazing.
2. Profilning dublikatlar bo‘limini ko‘ring.
3. **O‘quvchiga aylantirish** tugmasini bosing.
4. Mavjud o‘quvchilarni ism/telefon orqali qidiring. Mos yozuvni tanlang yoki yangi
   o‘quvchi uchun ism va familiyani alohida kiriting.
5. Yangi Student leadning telefoni, ota-ona ma’lumotlari va izohini oladi.
   Kerak bo‘lsa, avval lead profilida bu ma’lumotlarni to‘ldiring.
6. Tasdiqlash katagini belgilang va konvertatsiyani tasdiqlang.
7. Student profiliga havola lead profilida ko‘rinadi.

Server tasdiqni va Student yaratishning mavjud Zod qoidalarini tekshiradi.
Yangi o‘quvchining telefoni mavjud yozuvga to‘g‘ri kelsa, server `409` qaytaradi;
foydalanuvchi mavjud o‘quvchini ongli tanlashi kerak. Arxivdagi yoki boshqa tenant
Student’iga bog‘lash mumkin emas. Lead o‘zgarmagan holda saqlanadi, `convertedStudentId`
qo‘shiladi. Student, lead va audit bitta transaction ichida bajariladi. Tenantning
mavjud billing revision yozuvi parallel konvertatsiyalarni seriallashtiradi;
MongoDB write-conflict bo‘lsa transaction qayta urinadi. Ikkinchi so‘rov `409`
oladi. Xato bo‘lsa barcha yozuvlar rollback qilinadi. Replica set talab qilinadi;
transaction ishlamasa qisman yozishga o‘tish yo‘q.

Guruh a’zoligi, to‘lov, charge, davomat va maosh yozuvlari yaratilmaydi.

## API

Barcha yo‘llar `/api` ostida, amaldagi JWT cookie va Origin himoyasi bilan.
POST/PATCH JSON talab qiladi. `tenantId` body orqali qabul qilinmaydi.

| Metod | Endpoint | Vazifasi |
| --- | --- | --- |
| GET / POST | `/leads` | Ro‘yxat / yaratish |
| GET / PATCH | `/leads/:id` | Profil / tahrirlash |
| PATCH | `/leads/:id/status` | `{status, reason?}` |
| PATCH | `/leads/:id/assign` | `{assignedTo: id yoki null}` |
| PATCH | `/leads/:id/archive` | `{}` bilan arxivlash |
| GET | `/leads/:id/history` | Sahifalangan audit |
| GET | `/leads/:id/duplicates` | Telefon bo‘yicha lead/Student nomzodlari |
| POST | `/leads/:id/convert` | `{confirmed:true, student:{...}}` yoki `{confirmed:true, existingStudentId}` |
| GET | `/leads/staff` | Shu markazdagi faol owner/admin tanlovi |
| GET | `/leads/resources` | Faol guruh/o‘qituvchi tanlovlari |
| GET | `/leads/statistics` | Umumiy KPI, `byStatus`, `bySource` |
| GET / POST | `/trial-lessons` | Ro‘yxat / sinov yaratish |
| PATCH | `/trial-lessons/:id` | To‘liq sinov formasi bilan ko‘chirish/natija/bekor qilish |
| GET / POST | `/follow-ups` | Ro‘yxat / vazifa yaratish |
| PATCH | `/follow-ups/:id` | `{status:completed yoki cancelled}` |
| GET | `/dashboard` | Mavjud javobga `leads` statistikasi qo‘shildi |

Ro‘yxatlar: `page=1`, `pageSize=20` (1–100), `sort=asc|desc`.
Leadlar: `search`, `status`, `source`, `assignedTo`, `archived=true|false`.
Sinovlar: `leadId`, `date=YYYY-MM-DD`, `assignedTo` (o‘qituvchi ID).
Vazifalar: `leadId`, `assignedTo`, `bucket=today|overdue|upcoming`.
Tarix: `page`, `pageSize`, `sort`. Deterministik tartib uchun `_id` ham ishlatiladi.

## Sana, jadval va statistika

Barcha CRM taqvim chegaralari `Asia/Tashkent` (UTC+05:00).
Sinov `trialDate` sana matni, `startTime/endTime` `HH:mm` shaklida saqlanadi.
Vazifalar va audit UTC instant sifatida saqlanib, UI’da Toshkent vaqti bilan chiqadi.
`dueAt` va `nextFollowUpAt` API’da timezone offset bilan ISO datetime oladi.

Sinovning guruh/o‘qituvchi resurslari boshqa tenantga tegishli bo‘la olmaydi.
Guruh berilib o‘qituvchi tanlanmasa, guruhning o‘qituvchisi olinadi. Faol haqiqiy
Schedule, bekor qilinmagan LessonSession va boshqa sinovlar bilan vaqt kesishishi
tekshiriladi. Leadning o‘z sinovlari ham bir vaqtda bo‘la olmaydi. Yonma-yon
oraliqlar (09:00–10:00 va 10:00–11:00) ruxsat etiladi. Haqiqiy jadval yaratish va
faollashtirishda ham sinovlar hisobga olinadi. Mavjud scheduling revision lock
parallel yozuvlardan himoya qiladi. Resurs ko‘rsatilmagan sinovga resurs
bandligini tekshirish tatbiq etilmaydi.

**Konvertatsiya foizi = konvertatsiya qilingan barcha leadlar / barcha leadlar × 100**.
Hisob tenant doirasida, barcha vaqt uchun; arxivdagi yozuvlar ham hisoblanadi.
Maxraj 0 bo‘lsa natija 0%; ikki kasrgacha yaxlitlanadi. Shu oydagi leadlar —
Toshkentdagi oyning 1-kunidan hozirgacha yaratilganlar. Bugungi sinovlar — bugungi
sana, cancelled bundan mustasno. Kechikkan vazifalar — pending va dueAt < hozir.
Bugungi vazifalar kun boshidan keyingi kun boshigacha; upcoming keyingi kundan.

## Xavfsizlik

- RBAC barcha CRM routerlarda serverda: faqat owner/admin. Teacher va Super Admin
  uchun `403`; dashboard ularning javobiga lead ma’lumotlarini qo‘shmaydi.
- Har bir hujjat va bog‘lanish authenticated tenant bilan tekshiriladi.
- Strict Zod obyektlari mass assignment, begona kalitlar va noto‘g‘ri formatni rad etadi.
- Qidiruv regex belgilarini escape qiladi; sahifa va matn uzunligi cheklangan.
- JWT httpOnly/sameSite cookie, CSRF Origin tekshiruvi va mavjud global API rate
  limit (300/15 daqiqa) saqlangan.
- Telefon va request body logga yozilmaydi; audit matni API orqali tenantga ko‘ra beriladi.
- Status, vazifa, sinov va konvertatsiya amallari audit qilinadi. Tarixda xodim ID
  saqlanadi; sinovning har bir eski formasini to‘liq nusxalash qo‘shilmagan.

## Cheklovlar

- Kanban global pagination’ning joriy sahifasini bosqichlarga ajratadi; ustunlar
  uchun alohida pagination yoki drag-and-drop yo‘q.
- Guruh/o‘qituvchi tanlovlari dastlabki 100 ta faol yozuvni chiqaradi.
- Dublikatlar oynasi har tur uchun ko‘pi bilan 20 nomzod ko‘rsatadi; kengroq
  qidiruv uchun Student qidiruvi ishlatiladi. Avtomatik ism o‘xshashligi yo‘q.
- Follow-up uchun qayta ochish/tahrirlash bu bosqichga kiritilmagan; bekor qilib,
  yangi vazifa yaratish mumkin. Telegram avtomatlashtirish qo‘shilmagan.
- Visual browser tekshiruvida sun’iy API javoblari ishlatilgan; haqiqiy MongoDB
  oqimlari replica set integratsion testlarida tekshirilgan.
- Demo/production deploy bajarilmadi. Main merge va qo‘lda deploydan oldin jonli
  demo saytda yangi menyu bo‘lmaydi. Render va Atlas sozlamalari o‘zgartirilmagan.

## Demo yoki lokal tekshirish ssenariysi

Demo uchun PR’ni ko‘rib chiqib, alohida ruxsatlangan deploydan keyin quyidagilarni
sinang. Lokal variant: branchni oling, `npm ci`, README bo‘yicha `.env` va MongoDB
replica set tayyorlang, `npm run dev`; haqiqiy telefonlar o‘rniga sun’iy ma’lumot ishlating.

1. Owner/Admin sifatida kiring; Lead CRM → Lead qo‘shish.
2. Telefonli va telefonsiz lead yarating. Shu telefonda yana lead yarating,
   profil ogohlantirishini ko‘ring; bir xil ismli telefonsiz leadlar alohida qolsin.
3. Filtr, qidiruv, arxiv va pagination’ni tekshiring.
4. Leadni bog‘lanildi bosqichiga o‘tkazing; rad etishda sababsiz forma o‘tmasin.
5. Haqiqiy dars vaqtiga sinov qo‘shishga urining — to‘qnashuv chiqsin. Bo‘sh vaqtga
   yarating, ko‘chiring, qatnashdi yoki bekor qilindi natijasini saqlang.
6. Kechikkan, bugungi va kelgusi follow-up yarating; bajarildi/bekor qilishni sinang.
7. Konvertatsiya oynasida dublikatlarni tekshiring, ism/familiya kiriting va
   tasdiqlang. Qayta konvertatsiya yangi Student yaratmasin.
8. Boshqa leadni tasdiqlangan mavjud Student’ga bog‘lang. Guruh va to‘lov o‘z-o‘zidan
   yaratilmaganini tekshiring; tarix va dashboard ko‘rsatkichlarini solishtiring.
9. Teacher/Super Admin bilan CRM yo‘llariga kirish taqiqlanganini tekshiring.
10. Ikkinchi tenantda birinchi tenant lead, Student va xodim ID’larini ishlatish
    ma’lumot ochmasligi yoki yozmasligini tekshiring.
