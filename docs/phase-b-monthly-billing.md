# Phase B — avtomatik oylik billing

Holat: kod darajasida tayyorlash; production faollashtirilmagan. Phase A production
backup keyinga qoldirilgan va tayyor deb hisoblanmaydi. Phase C va boshqa
avtomatlashtirishlar ushbu ish doirasiga kirmaydi.

## Main auditi va topilgan bo‘shliqlar

Asos: `f975bcec3a7cdc0d1c8a541d4bb0f26cbb91cefc`. PR #45 allaqachon
2026-11-10 16:09:25 UTC’da merge qilingan; ushbu ish uni merge qilmagan.

| Qism | Main’da mavjud | Phase B’da qo‘shildi/tuzatildi |
| --- | --- | --- |
| `billing-calculation.ts` | Asia/Tashkent, dars sanalari, bekor qilingan/materialized darslar, guruh narxi, birinchi qisman oy, qo‘shilish vaqti, exact integer rounding | Formula o‘zgarmadi |
| `tuition-service.ts` | Faol tenant/o‘quvchi/a’zolik/guruh, tenant billing lock, snapshot transaction, 10 tenantlik cursor batch | Xuddi shu charge rejasiga asoslangan yozuvsiz oylik preview, atomik audit completion |
| `billing-models.ts` | Tenant/student/group/month unique indeks; tarixiy, to‘langan, bekor qilingan hisoblar saqlanadi | Embedded snapshot’da `versionKey: false`: rollback vaqtida mavjud bo‘lmagan `__v`ni tiklash xatosi bartaraf etildi |
| `tuition-scheduler.ts` | Alohida secret, rate limit, qat’iy cursor input, faqat joriy oy | Default-off yozish flag’i, dry-run, tenant/RBAC bilan chegaralangan tarix |
| `billing.ts` | Tasdiqlanadigan manual generation va to‘lovlar | Mustaqil preview endpoint; manual rejim scheduler/audit holatiga bog‘lanmadi |
| `tuition-billing.yml` | Kunlik idempotent chaqiruv, cursor, retry, response validation | Explicit opt-in + main gate, dispatch’da default dry-run, dry-run acknowledgement tekshiruvi |
| Admin panel | Manual billing natijalari va individual calculation | Server holati, urinishlar/xatolar/summalar, pagination, refresh va oylik preview |

## API va holatlar

- `POST /api/billing/charges/preview`: owner/admin, `{ month: "2026-11", dueDay?: 1..28 }`.
  Server session’dan tenantni oladi; caller tenant/actor yubora olmaydi. Javob:
  `dryRun: true`, `created: 0`, `wouldCreate`, `skipped`, `amount`, `month`, `timezone`.
  `amount` — faqat yangi yaratilishi mumkin bo‘lgan hisoblar summasi. Mavjud
  hisoblar `skipped` bo‘ladi. Hisoblar, audit va billingRevision yozilmaydi;
  read-only snapshot transaction ishlatiladi. Bu kafolatlangan quote emas:
  haqiqiy yaratish vaqtida qayta hisoblanadi.
- `GET /api/billing/automation?month=2026-11&page=1`: owner/admin, faqat o‘z
  tenant’i, 20 yozuv/sahifa. `month` bo‘lmasa barcha oylar. Sana va id bo‘yicha
  barqaror teskari tartib; begona tenant parametri rad etiladi.
- `POST /api/internal/billing/run`: alohida bearer secret; `{ after?: ObjectId,
  dryRun?: boolean }`. Oy va tenant caller’dan qabul qilinmaydi. Oy serverning
  Asia/Tashkent vaqtidan olinadi. Dry-run’da ham secret talab qilinadi.
- CLI: `npm run billing:monthly:dev -w @softlans/api -- --dry-run` shu batch
  engine’ini ishlatadi, indekslar yaratmaydi. Ushbu ish davomida CLI haqiqiy
  bazaga ulanmagan. Uni production konfiguratsiyasi bilan ishga tushirmang.

`TuitionRun` har tenant/urinish uchun alohida, cheklangan hajmli hujjat. Faqat
vaqtlar, oy, status, hisoblar soni/summasi va allowlist xato kodi saqlanadi.
O‘quvchi ismlari, URI, secret va raw exception saqlanmaydi. Tenant + sana/id
indeksi tarix query’siga mos. Audit yozuvlari avtomatik o‘chirilmaydi.

1. Ish boshlanishi hisob tranzaksiyasidan oldin `running` sifatida yoziladi.
2. Hisoblar va `completed` natija bitta tranzaksiyada commit bo‘ladi. Audit
   completion yozilmasa, shu tenantning yangi hisoblari ham rollback bo‘ladi.
3. Xatoda `failed`, `BILLING_OWNER_REQUIRED` yoki `BILLING_RUN_FAILED` yoziladi.
   Muvaffaqiyatli commit holati `running` predicate bilan himoyalanadi.
4. Process uzilsa yoki xatoni yozishga DB yetmasa, `running` qolishi mumkin.
   UI buni **natija tasdiqlanmagan** deydi; bu muvaffaqiyat emas. Qayta urinish
   yangi audit urinishini yaratadi va mavjud hisoblarni takrorlamaydi.

Batch oldingi tenantlar commitini saqlaydi va birinchi xatoda to‘xtaydi. Owner
muammosi yoki DB xatosini bartaraf etib, shu cursor’dan qayta urinish mumkin;
oldingi hisoblar qayta yaratilmaydi. Uzoq davom etuvchi bitta katta tenant
tranzaksiyasini bo‘lib yuborish bu o‘zgarishda qilinmadi. Oy batchlar orasida
almashsa workflow muvaffaqiyat bermaydi; keyingi ishga tushish joriy oyni oladi.
Eski oy catch-up uchun mavjud qo‘lda billing rejimi saqlangan.

## Faollashtirish chegarasi

Ushbu PR hech qaysi production variable/secret’ni o‘zgartirmaydi, scheduler’ni
ishga tushirmaydi, MongoDB’ga production yozuv kiritmaydi va Render deploy qilmaydi.

- API/CLI’da `BILLING_SCHEDULER_ENABLED` default `false`; faqat aniq `"true"`
  yozishga ruxsat beradi. API’da alohida secret ham kerak. Secretning o‘zi yetmaydi.
- GitHub workflow main branch va repository variable
  `BILLING_SCHEDULER_ENABLED == 'true'` hamda URL bo‘lmasa ishlamaydi.
  Manual dispatch default dry-run. Bu job’da ham opt-in gate saqlanadi.
- Admin’dagi `schedulerEnabled` faqat API konfiguratsiyasini bildiradi;
  GitHub Actions ishlaganini yoki production readiness’ni tasdiqlamaydi.
- O‘chirish uchun API flag’ini va workflow opt-in’ini o‘chirish mumkin;
  qo‘lda billing o‘z faoliyatini davom ettiradi. Allaqachon yozilgan hisoblarni
  o‘chirish rollback rejasi emas; mavjud owner correction/reversal ishlatiladi.

Production faollashtirish alohida topshiriq, konfiguratsiya tekshiruvi va
ruxsatli staging qabul sinovidan keyingi ish. Backup hali tayyor emas.

## Sintetik tekshiruvlar

- Mavjud proratsiya testlari: 12/13/14 darsli oy, kabisa, yil almashishi,
  qo‘shilishning millisekund chegarasi, guruh boshlanishi, jadval effective
  sanalari, materialized/cancelled darslar, nol hisob, full-month, re-enrollment,
  immutable/to‘langan/legacy hisoblar.
- Yangi testlar: yozuvsiz preview va amount parity; scheduler default-off;
  tenant/RBAC/injection; inactive/paused/removed va begona ref; scheduler/manual
  race; ikkinchi insertdan keyingi rollback; haqiqiy transient transaction retry;
  audit completion failure rollback; audit ishlamasa manual fallback.
- 11 tenantlik qisman batch failure, keyingi retry/cursor, ikki parallel batch va
  duplicate yo‘qligi; missing-owner audit kodi.
- Workflow kodi tarmoqsiz VM’da bajariladi: timeout/503 retry, 401, noto‘g‘ri
  response, cursor loop, oy almashishi va dry-run/write acknowledgement.
- React: holat/tarix, xato/retry, preview validation, klaviatura, pagination va
  manual generationdan keyin preview’ni tozalash. Mavjud manual billing testlari saqlandi.
- Chromium’da faqat sintetik API: 320, 375, 390, 600, 640, 699, 700, 701, 768,
  900, 1024, 1440 px. Page overflow va page error yo‘q; preview hech qachon
  `/generate` yoki internal scheduler’ni chaqirmagan.

Barcha integration testlar faqat o‘zlari ochgan loopback MongoDB replica set’da
ishlaydi; meros URI’lar test setup’da olib tashlanadi. Tekshiruv natijalari
Draft PR tavsifida va uning GitHub CI checks’ida qayd etiladi.
