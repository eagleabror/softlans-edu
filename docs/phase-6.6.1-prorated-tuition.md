# Phase 6.6.1 — Darslarga mutanosib avtomatik billing

## Hisoblash va saqlash

Standart guruh siyosati `first_partial_month`. `full_month` — sozlanadigan muqobil
siyosat. Guruh formasida yoki Group API orqali `billingPolicy` va `billingDueDay`
(1–28, standart 10) tanlanadi. Siyosat o‘zgarishi faqat yangi hisoblarga ta’sir qiladi.

Oy Asia/Tashkent bo‘yicha [oy boshi, keyingi oy boshi) oralig‘i. Qo‘llab-quvvatlangan
2000–2199-yillarda UTC+05:00 ishlatiladi. Guruhning `startDate` qiymati mavjud
ilovadagi date-only sana sifatida olinadi. Jadvalning `effectiveFrom` va
`effectiveUntil` sanalari inklyuziv. Hafta kunlari ISO 1–7. Har bir jadval/sana
bitta dars; bir kunda turli vaqtlardagi ikki dars ikkita hisoblanadi.

`Membership.enrolledAt` serverdagi haqiqiy timestamp: dars boshlanishiga teng yoki
undan oldin qo‘shilsa darsga haqli, hatto 1 ms keyin qo‘shilsa bu dars kiritilmaydi.
O‘quvchining umumiy CRM `enrollmentDate` sanasi guruhga qo‘shilgan vaqt o‘rniga
ishlatilmaydi. Qayta qo‘shilish yangi birinchi oy chegirmasini bermaydi: eng birinchi
Membership sanasi siyosat uchun, joriy Membership sanasi qolgan darslar uchun olinadi.
Oydan chiqish uchun avtomatik qaytarim yoki oxirgi oy proratsiyasi yo‘q.

Birinchi oy summa = `round(monthlyFee × eligibleLessons / totalLessons)`.
BigInt arifmetika orqali yaxlitlash bir marta, yarim qiymat yuqoriga bajariladi.
Bir darsning taxminiy narxi faqat ko‘rsatish uchun; undan yakuniy summa hisoblanmaydi.
Keyingi oyda kamida bitta rejalashtirilgan dars bo‘lsa to‘liq oylik summa olinadi.

Misol: 2026-11, Du/Chor/Ju 10:00, 300 000 UZS, 16-noyabr 09:00 da qo‘shilish:
13 darsdan 7 ta qoladi, hisob **161 538 UZS**. Dekabr — **300 000 UZS**.

To‘lov muddati — guruhdagi billingDueDay kuni 23:59:59.999 Tashkent vaqti bilan;
agar undan keyin qo‘shilsa, qo‘shilish vaqtigacha uzayadi. Guruh boshlanish sanasidan
oldin muddat qo‘yilmaydi. Qo‘lda ommaviy generatsiyada tanlangan dueDay ustun.

Charge qiymatlari:

- `originalAmount` — dastlabki oylik narx (keyinchalik faqat auditli qo‘lda tuzatish).
- `prorationAmount` — immutable proratsiya ayirmasi, qo‘lda chegirma emas.
- `discountAmount` — alohida qo‘lda chegirma.
- `finalAmount = originalAmount − prorationAmount − discountAmount`.
- `calculation` — immutable policy version, siyosat, timezone, oy, oylik narx,
  jami/qolgan darslar, hisoblangan summa, ayirma, enrollment timestamp, muddat,
  darslarning schedule/date kalitlari va UTC boshlanish vaqtlari.
- `generationSource` — enrollment / manual / scheduled; `generatedBy` va
  `payrollTeacherId` mavjud audit va maosh atributsiyasini saqlaydi.

## Jadval istisnolari bo‘yicha aniq siyosatlar

| Holat                                      | Yangi hisobdagi xatti-harakat                                                                                                                                                                                                                                                          |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bayram                                     | Taqvimdan taxmin qilinmaydi. Davomatdagi LessonSession bekor qilinishi yoki jadvalning effective oralig‘i orqali aniq ifodalanadi.                                                                                                                                                     |
| Bekor qilingan dars                        | Mavjud `LessonSession.status=cancelled` shu schedule/sana takrorlanishini almashtiradi; jami va qolgan darslardan chiqariladi.                                                                                                                                                         |
| Ko‘chirilgan dars                          | Eski session bekor qilinadi, almashtiruvchi jadval aniq effective oralig‘i bilan yaratiladi. Dars yangi sananing oyiga tushadi. Bir martalik dars uchun effectiveFrom=effectiveUntil.                                                                                                  |
| Jadval tahriri                             | Materializatsiya qilingan tarixiy session eski boshlanish vaqtini saqlaydi; yangi recurrence shu schedule/sana uchun ikkinchi dars yaratmaydi. Kelajakdagi o‘zgarishlar uchun eski jadval effectiveUntil bilan yakunlanib, yangi jadval effectiveFrom bilan ochilishi tavsiya etiladi. |
| Nofaol jadval                              | Kelajak recurrence hisoblanmaydi; saqlangan historical sessionlar hisoblanadi.                                                                                                                                                                                                         |
| Nol darsli oy                              | 0 UZS charge va 0/0 snapshot; bo‘lish xatosi yo‘q. Dars keyin qo‘shilsa eski 0 hisob ham avtomatik oshirilmaydi.                                                                                                                                                                       |
| Oxirgi darsdan keyin qo‘shilish            | Birinchi oy 0 UZS; keyingi darsli oy to‘liq summa.                                                                                                                                                                                                                                     |
| Kelajakda boshlanadigan guruh              | Boshlanish oyigacha charge yaratilmaydi; scheduler boshlanish oyini hisoblaydi.                                                                                                                                                                                                        |
| Paused/archived guruh yoki nofaol o‘quvchi | Avtomatik charge yo‘q; faol bo‘lgach current-month scheduler yoki qo‘lda generatsiya ishlatiladi.                                                                                                                                                                                      |
| Hisob yaratilgandan keyingi o‘zgarish      | Charge va snapshot, to‘lovlar, tasdiqlangan Payroll o‘zgarmaydi. Markaz egasi sabab bilan mavjud ChargeAdjustment oqimidan foydalanadi.                                                                                                                                                |

Bayram/cancellation denominatorni ham o‘zgartiradi; bu siyosat yangi hisoblargagina
qo‘llanadi. Mavjud hisobda avtomatik qaytarim yo‘q. Owner auditli tuzatishi
proratsiya snapshotini qayta yozmaydi. To‘langan summadan pastga tushirish va
to‘lov mavjud hisobni bekor qilish mavjud himoyalar bilan rad etiladi.

## Avtomatlashtirish va himoya

Guruhga o‘quvchi qo‘shish va birinchi charge bitta MongoDB tranzaksiyada bajariladi.
Xato bo‘lsa a’zolik/sig‘im/charge birga rollback qilinadi. Group/Schedule yozuvlari,
manual generatsiya, payment va scheduler mavjud tenant billing qulfidan foydalanadi.
Schedule yozish scheduling qulfidan keyin billing qulfini oladi. Unique indeks:
`tenantId + studentId + groupId + billingMonth`. Bekor qilingan hisob ham duplicate
hisoblanadi, avtomatik almashtirilmaydi.

Preview: `GET /api/groups/:id/billing-preview?studentId=...`, faqat owner/admin,
tenant scope bilan. UI oltita o‘zbekcha ko‘rsatkichni beradi, tasdiqsiz saqlamaydi.
Qaytgan `previewKey` membership POST’iga yuboriladi; narx/dars/oy/siyosat o‘zgarsa
409 qaytadi. Enrollment timestamp client tomonidan belgilanmaydi. PreviewKey
eski integratsiyalarni buzmaslik uchun API’da ixtiyoriy, yangi UI’da majburiy.

### Scheduler o‘rnatish (ushbu PR deploy qilmaydi)

Repository’da `.github/workflows/tuition-billing.yml` kunlik cron namunasi mavjud.
U faqat `BILLING_SCHEDULER_URL` repository variable (to‘liq HTTPS endpoint) va
`BILLING_SCHEDULER_SECRET` Actions secret operator tomonidan sozlangach ishlaydi.
Workflow cursorlarni davom ettiradi, 429/5xx’da cheklangan qayta urinish qiladi,
redirectga credential yubormaydi. Ushbu PR bu variable/secretlarni sozlamaydi.

Kichik markazlar uchun tashqi scheduler har kuni **00:05 Asia/Tashkent**
(UTC cron: `5 19 * * *`) va xatodan so‘ng qayta urinish bilan quyidagini chaqirsin:

```http
POST /api/internal/billing/run
Authorization: Bearer <BILLING_SCHEDULER_SECRET>
Content-Type: application/json

{}
```

Alohida tasodifiy 43–128 belgili `BILLING_SCHEDULER_SECRET` backend va scheduler
secret storage’da saqlanadi. JWT, Telegram yoki notification secret bilan bir xil
bo‘lishi rad etiladi. Secret bo‘lmasa 503; noto‘g‘ri bearer/cookie/query auth — 401.
TLS ishlatilishi kerak. Secretni URL, brauzer kodi yoki logga joylashtirmang.

Har chaqirish 10 tagacha faol tenantni hisoblaydi. Javobdagi `nextCursor` null
bo‘lmaguncha `{ "after": "<nextCursor>" }` bilan davom etiladi. Rate limit 10/min;
429 bo‘lsa kutib qayta urinish kerak. Oxirgi muvaffaqiyatli cursor’dan qayta urinish
xavfsiz. HTTP javob faqat ish tugagach 200; process to‘xtasa qayta chaqirish xavfsiz.
Har tenant uchun mavjud faol business_owner audit aktori olinadi; owner topilmasa
xato qaytadi va operator tuzatishi kerak. So‘rovga tenant yoki tarixiy oy kiritib
bo‘lmaydi. Avtomatizatsiya faqat **joriy Tashkent oyi**ni yaratadi, tarixiy qarzlarni
avtomatik backfill qilmaydi.

Katta bazalarda HTTP timeout o‘rniga private scheduled CLI tavsiya qilinadi:

```sh
npm run build
npm run billing:monthly -w @softlans/api
```

CLI barcha batchlarni yuradi; DB va konfiguratsiya server secretlari orqali olinadi.
Jarayon xatosida exit code 1. Har tenant tranzaksiyasi alohida; takror ishga tushirish
avval yaratilgan hisoblarni o‘zgartirmaydi. Scheduler intervalida current-month
a’zolik qo‘shish xatolari va guruh reaktivatsiyasi ham qoplanadi.

Mavjud “Oylik hisob yaratish” owner/admin tasdiqli qo‘lda fallback sifatida qoladi.
To‘lov allocation, qarz hisobi va billed/collected payroll foizlari mavjud
`finalAmount`/haqiqiy to‘lovlardan hisoblanadi; yangi parallel moliyaviy ledger yo‘q.

## Tarixiy ma’lumotlar

Migratsiya yoki backfill yo‘q. Snapshot maydoni historical charge uchun ixtiyoriy,
prorationAmount yo‘qligi o‘qishda 0 deb olinadi. Mavjud charge topilganda hech qanday
update/save bajarilmaydi. Tarixiy yozuvni lesson-based hisobga aylantirish faqat
alohida tasdiqlangan migratsiya bilan, ushbu PR’dan tashqarida bajarilishi mumkin.

## Tekshirish va vizual dalillar

Unit testlar: 12/13/14 darsli oylar, kabisa 29-fevral, yil chegarasi, mid-day/same-day,
effective sanalar, group start, bekor/ko‘chirilgan darslar, nol dars, aniq yaxlitlash.
Integratsiya: takror/concurrent generation, enrollment rollback, preview/RBAC/tenant,
chegirma va payment safety, immutable snapshot, historical va approved payroll safety.
UI: olti ko‘rsatkich, majburiy tasdiq, xato/retry, mavjud charge va nol oy.
Natijalar va synthetic-data screenshotlar `artifacts/phase-6.6.1/` papkasida.
