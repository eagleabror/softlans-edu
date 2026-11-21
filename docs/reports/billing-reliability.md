# Billing reliability: tekshiruv va o‘zgarishlar

Baza: GitHub’dan olingan `main` = `99898d5fa42ef1a80a72eb6ed43894a0bbcb84f7`.
Branch: `fix/billing-reliability`. Ish boshlanganda working tree toza edi.
Production baza yoki Render konfiguratsiyasiga ulanilmadi; scheduler, secret,
merge, deploy va ma’lumot migratsiyasi bajarilmadi.

## Audit natijalari

| Topilma | Joriy main bo‘yicha xulosa |
| --- | --- |
| Jadvalsiz enrollment 0 hisob bilan oy kalitini band qiladi | Tasdiqlandi: yangi regression test oldin yiqildi. |
| Owner yo‘q tenant butun batch’ni to‘xtatadi | Tasdiqlandi: A/B/C testi `BILLING_OWNER_REQUIRED` bilan uzildi. |
| Bitta IP CRM va Telegram uchun 300/15 daqiqalik limitni bo‘lishadi | Tasdiqlandi: birinchi user 300 so‘rovdan keyin ikkinchisi 429 oldi. |
| Har o‘quvchi uchun guruh/jadval/darslar qayta o‘qiladi | Tasdiqlandi: 500 o‘quvchida har biri 500 marta. |
| Tranzaksiyada parallel Mongo operatsiyalari | Ushbu yo‘lda topilmadi: ketma-ket `await` mavjud edi va saqlandi. |
| Katta tenant uchun tranzaksiyani bo‘lish shart | Hozircha o‘lchov bilan isbotlanmadi. Atomiklikni saqlab, avval takroriy o‘qishlar kamaytirildi. |
| Render blueprint eski feature branch’ga qaraydi | Repo faylida tasdiqlandi. Main allaqachon readiness tuzatishlarini o‘z ichiga oladi; branch main qilindi, auto-deploy off saqlandi. Live holat noma’lum. |
| To‘langan/tuzatilgan/bekor qilingan hisoblarni qayta yozish | Mavjud himoya to‘g‘ri: `Charge.exists`, unique index, tenant lock va immutable snapshot saqlandi. |

## Yangi xulq

- Hisoblash snapshot’i `readiness` (`ready`, `schedule_missing`, `not_due`)
  va o‘zbekcha `reason` qaytaradi. Eski snapshot’lar uchun maydonlar optional.
- Pullik guruhda tegishli oy uchun hech bir recurrence/materialized lesson bo‘lmasa,
  yakuniy Charge yaratilmaydi. Preview/generate `deferred` va `SCHEDULE_MISSING`
  sababini qaytaradi. UI buni yakuniy 0 UZS sifatida ko‘rsatmaydi.
- Bepul kurs jadvalsiz ham 0; barcha darslari cancelled oy va oxirgi darsdan keyin
  birinchi marta qo‘shilish haqiqiy 0 bo‘lib qoladi. Kelajak guruhiga shu oyda
  hisob yozilmaydi. Faqat keyingi oyga tegishli jadval joriy oyni tayyor qilmaydi.
- Jadval tayyor bo‘lgach manual generate ishlaydi. Parallel/retry chaqiruvlar
  aynan bitta hisob yaratadi; mavjud moliyaviy tarix qayta yozilmaydi.
- Transaction-local cache guruh, schedule va lesson o‘qishlarini kamaytiradi.
  Tenant/month kalitlari, snapshot read concern, majority write concern va billing
  lock saqlandi. Driver tranzaksiyani takrorlasa cache va counters yangidan boshlanadi.
- Faqat typed tenant biznes xatolari (`BILLING_OWNER_REQUIRED`,
  `BILLING_TOTAL_LIMIT`) davom ettiriladi. Audit xatosi, Mongo uzilishi va noma’lum
  xato request’ni yiqitadi. Har tenant o‘z tranzaksiyasida commit bo‘ladi; keyingi
  tenant yiqilsa oldingilari saqlanadi, retry unique kalit orqali deduplikatsiya qiladi.
- Batch response: `status`, `failed`, `errors[{tenantId,code}]`, `deferred`, eski
  counters va `nextCursor`. `status` shu **batch** holati, butun workflow holati emas.
  Workflow har cursor’ni tekshiradi, xatolarni ko‘rsatadi, sog‘lom tenant’larni
  tugatadi va biror tenant xatosi bo‘lsa yakunda nonzero chiqadi. CLI ham nonzero.
  Failed tenant tuzatilgach boshidan retry qilish xavfsiz; eski cursor’dan keyingi
  sahifani davom ettirish avvalgi failed tenant’ni o‘z-o‘zidan qayta ishlamaydi.
- Manual billing/payroll mustaqil; scheduler opt-in shartlari o‘zgarmadi.

## Rate limitlar

| Trafik | Limit |
| --- | --- |
| CRM | DB’da tekshirilgan user ID uchun 300 / 15 daqiqa |
| Browser API coarse IP ceiling | 10 000 / 15 daqiqa |
| Login | Avvalgi 15 / 15 daqiqa / IP |
| Register | Avvalgi 5 / soat / IP |
| Password recovery, MFA | Mavjud endpoint IP limiterlari saqlandi |
| Telegram webhook | Mustaqil 600 / daqiqa / IP |
| Har internal scheduler prefix | Mustaqil 120 / daqiqa / IP; mavjud authenticated endpoint limiti ham saqlandi |
| Health/readiness GET/HEAD | API byudjetini sarflamaydi |

User/tenant header yoki request body limiter identity’si bo‘la olmaydi.
Cookie imzosi, session revocation, faol user/tenant va RBAC tekshiruvlari oldin
bajariladi. Webhook/scheduler autentifikatsiyasi saqlandi. `TRUST_PROXY_HOPS`
o‘zgarmadi; mavjud rightmost trusted-hop regressioni saqlandi. Deploy topologiyasi
shu sozlamaga mos bo‘lishi kerak. Limiter storage avvalgidek process-local: ko‘p
instance uchun global distributed quota kafolati yo‘q. Yangi xizmat qo‘shilmadi.

## O‘lchov

Disposable MongoDB 7.0.24 replica set, bitta guruh, bitta dushanba jadvali,
2025-02, fee=1000, avvaldan enrolled faol o‘quvchilar. Bir xil test oldin/keyin
`generateTuitionMonth(..., {dryRun:true})` vaqtini va Mongoose `find*` operatsiyalarini
sanadi. Fixture/index yaratish va Mongo yuklab olish vaqtga kirmaydi. Bu bitta
lokal kuzatuv; production latency, write throughput yoki p95 benchmark emas.

| O‘quvchi | Oldin o‘qishlar | Keyin o‘qishlar | Oldin ms | Keyin ms | Har ikkala summa |
| --- | ---: | ---: | ---: | ---: | ---: |
| 10 | 61 | 34 | 62 | 37 | 10 000 |
| 500 | 3001 | 1504 | 2916 | 1502 | 500 000 |

Oldin: membership N+1, group N, charge N, student N, schedule N, lesson N.
Keyin: membership N+1, group 1, charge N, student N, schedule 1, lesson 1.
Natijalar vaqtning tabiiy o‘zgarishini ko‘rsatadi; umumiy tezlashish foizi va’da
qilinmaydi. Tranzaksiya hozircha butun tenantni qamraydi. Juda katta tenant va
uzoq tarmoq kechikishi hali duration/memory xavfi; bounded member batches keyingi
alohida, snapshot va run progress dizayni talab qiladigan ish. Hozir per-tenant
`completed` faqat barcha yozuvlar bilan bir transaction’da commit qilinadi.

## Eski 0 hisoblar: xavfsiz tartib

1. Owner sessiyasi bilan `GET /api/billing/charges/zero-diagnostics?month=YYYY-MM`
   chaqiriladi. `nextCursor` bo‘lsa `&after=...` bilan davom etiladi (50/sahifa).
   Bu GET snapshot transaction’da faqat o‘qiydi; production’da bu ish bajarilmadi.
2. `free_course`, `no_eligible_lessons`, `zero_with_snapshot`, `protected`,
   `insufficient_evidence`, `review_required` klassifikatsiyalarini tekshiring.
   `review_required` **xato isboti emas**: eski snapshot bekor qilingan darslar va
   yo‘q jadvalni ishonchli ajratolmaydi. Faqat `finalAmount=0` yetarli emas.
3. Owner original enrollment, guruh narxi/siyosati, o‘sha oy jadvali va cancellation
   tarixini solishtirib, aniq Charge ID, kutilgan summa va sababni yozma tasdiqlaydi.
   Paid, cancelled yoki adjustment/payment tarixi bor yozuvlar avtomatik tuzatilmaydi.
4. Ushbu PR **repair/migration endpoint yaratmaydi**. Oddiy generate tarixni
   tuzatmaydi va diagnostika uni o‘chirmaydi. Mavjud umumiy adjustment endpoint’ini
   avtomatik repair sifatida ishlatmang: unda maxsus repair confirmation/idempotency
   protokoli yo‘q. Qo‘lda originalAmount’ni oshirish orqali immutable proration’ni
   yashirish ham bu PR tavsiya qiladigan repair emas.
5. Tasdiqlangan repair zarur bo‘lsa alohida ko‘rib chiqiladigan o‘zgarish kerak:
   owner RBAC, `confirmed:true`, majburiy sabab, tenant+charge+operation unique
   idempotency kaliti va payload fingerprint, expected revision/snapshot tekshiruvi,
   billing lock ostida transaction, payment/adjustment/cancel holatini qayta tekshirish,
   o‘zgarmas oldin/keyin audit. Bir xil retry oldingi natijani qaytarishi, boshqa
   payload shu kalitda conflict berishi shart. Bularsiz bulk repairni bajarmang.

## Render tekshirish va rollback (faqat yo‘riqnoma)

- Dashboard → xizmat → Settings / Build & Deploy’da branch `main` va auto deploy
  `Off` ekanini operator tekshiradi. Repo blueprint live sozlama isboti emas.
- Events / Deploys’dan `Live` deploy’ning to‘liq commit SHA’sini, status/time’ni
  yozib oling. `git fetch origin main` va `git show <deployed-sha>` bilan solishtiring;
  `git merge-base --is-ancestor <fix-sha> <deployed-sha>` fix kirganini tekshiradi.
  Branch nomi yoki build vaqti o‘zi yetarli emas.
- Deploy alohida tasdiqlansa avvalgi sog‘lom deploy ID/SHA’ni saqlang. Rollback
  kerak bo‘lsa Dashboard’da o‘sha deploy’ning rollback/redeploy amalini operator
  tanlaydi; so‘ng Live SHA, `/api/health`, `/api/ready`, login va manual preview
  tekshiriladi. Schema additive; eski charge snapshot’lar saqlangan.
- Rollback ma’lumot migratsiyasi emas: yozilgan charge/audit’larni o‘chirmang.
  Scheduler disabled holatini qayta tekshiring. Ushbu ishda deploy boshlanmadi.

## Tekshiruvlar

Test setup inherited `MONGODB_URI` va
`TEST_MONGODB_URI`ni o‘chiradi hamda faqat disposable loopback URI’ni qabul qiladi.
Sandbox lokal portni bloklagan birinchi urinish test natijasi deb hisoblanmadi;
port ochishga ruxsat berilgan qayta urinishlar ishlatildi.

Oldin: yangi billing regressionlar 5 failed, readiness unit 1 failed,
workflow contract 5 failed, UI pending-price 1 failed, Render branch 1 failed.

Qayta o‘lchovda, to‘liq suite va build bilan bir vaqtda CPU band bo‘lganda,
keyingi versiya 10/500 o‘quvchida 104/4132 ms berdi; o‘qishlar 34/1504 va summalar
bir xil qoldi. Shuning uchun vaqt natijasini qat’iy tezlashish kafolati sifatida
ishlatib bo‘lmaydi; takroriy query kamayishi esa test bilan deterministik tekshiriladi.

UI o‘zgarishlari mavjud notice/status matnlarini qayta ishlatadi. React regressioni
jadval yo‘q holatni yakuniy 0 narx sifatida ko‘rsatmasligini tekshiradi; bu ishda
alohida brauzer/mobile/contrast auditi bajarilmadi. Build’da mavjud katta bundle
va FinancialReports static/dynamic import ogohlantirishlari qoladi.

Birinchi to‘liq suite’da eski operational-readiness testi owner yo‘q bo‘lsa 500 va
4 ta oldingi tenant commit’ini kutgani uchun yiqildi. Kutish yangi kontraktga
moslandi: 200/partial, 9 sog‘lom tenant commit’i, failed owner audit’i, cursor,
owner faollashgach faqat bitta yangi charge. O‘sha faylning 2 testi qayta o‘tdi.


### Yakuniy natijalar

| Tekshiruv | Natija |
| --- | --- |
| Billing/calculation/workflow/manual regressions | 73 passed; keyin qo‘shilgan legacy no-lesson diagnostika testi ham passed |
| Operational readiness, yangi partial kontrakt | 2 passed |
| `npm run typecheck` | passed, barcha workspaces |
| `npm test` | exit 0: API 44 fayl / 654 passed / 1 skipped; web 28 fayl / 162 passed; contracts 1 fayl / 1 passed |
| `npm run build` | passed, barcha workspaces; yuqorida yozilgan bundle ogohlantirishlari bor |
| `git diff --check` | passed |

Jami 817 test passed, 1 skipped. Skip — `recovery.test.ts`dagi native encrypted
backup/restore drill: `DR_DRILL_CONFIRM=synthetic-only` opt-in berilmadi. U passed
sifatida sanalmadi. Yakuniy API suite 269.34 s, web 50.91 s, contracts 0.15 s.

### PR matni

Sarlavha: `fix(billing): defer unscheduled charges and isolate tenant failures`

Jadvalsiz enrollment endi oy kalitini 0 hisob bilan band qilmaydi. Manual generate
jadval tayyor bo‘lgach yagona hisob yaratadi; immutable tarix va haqiqiy nol
hisoblar saqlanadi. Tenant biznes xatolari auditlanib, sog‘lom tenantlar davom
ettiriladi; workflow partial xatolarni yashirmaydi. CRM/user, auth/IP,
Telegram va scheduler limitlari ajratildi. Group/month cache takroriy o‘qishlarni
kamaytiradi. Owner-only read-only legacy diagnostika va main/manual Render
blueprint bilan rollback yo‘riqnomasi qo‘shildi. 817 test passed, 1 optional DR
skipped; typecheck/build passed. Deploy, merge va production repair yo‘q.
