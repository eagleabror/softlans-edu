# Phase 6.6.1 — O‘zbekcha texnik hisobot

Darslarga mutanosib avtomatik billing mavjud Group, Schedule, Membership, Charge,
Payment va Payroll oqimlariga qo‘shildi. Alohida moliyaviy ledger yaratilmagan.

## Natija

- Standart siyosat birinchi qisman oyga qo‘llanadi; guruh formasida to‘liq oylik
  siyosat va to‘lov kuni ham sozlanadi.
- Asia/Tashkent, hafta kunlari, group start, effective sanalar va dars boshlanish
  vaqtiga nisbatan haqiqiy enrollment timestamp hisobga olinadi.
- 300 000 × 7 / 13 → **161 538 UZS**; keyingi darsli oy **300 000 UZS**.
- A’zolik va birinchi hisob bitta tranzaksiyada yaratiladi. Tenant billing qulfi
  va student/group/month unique indeksi duplicate va concurrent yozishdan himoya qiladi.
- Snapshot narx, darslar, summa, siyosat versiyasi, ilk/joriy enrollment va muddatni
  saqlaydi. Proratsiya va qo‘lda chegirma alohida. To‘langan yoki tarixiy hisoblar
  qayta generatsiyada o‘zgarmaydi; owner tuzatishi sabab bilan auditga yoziladi.
- Preview narx, jami/qolgan darslar, taxminiy dars narxi, yakuniy summa va muddatni
  ko‘rsatadi. Tasdiq va eskirgan preview uchun server tekshiruvi mavjud.
- Bearer-secret bilan himoyalangan current-month scheduler, cursor batchlari,
  private CLI va opt-in kunlik GitHub Actions workflow mavjud. Qo‘lda generatsiya saqlandi.
- Hech qanday historical migration/backfill, merge yoki deploy bajarilmadi.

Batafsil siyosatlar, endpointlar va scheduler sozlamalari:
[implementatsiya hujjati](../../docs/phase-6.6.1-prorated-tuition.md).

## Tekshiruvlar

| Tekshiruv                         | Natija                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------- |
| Backend testlar                   | 34 fayl, 501 passed; 1 opt-in backup/restore drill skip                           |
| Frontend testlar, yakuniy versiya | 22 fayl, 121 passed                                                               |
| Typecheck                         | API va web muvaffaqiyatli                                                         |
| Production build                  | Muvaffaqiyatli; mavjud Vite chunk-size va mixed-import tavsiyalari qolgan         |
| npm audit                         | 0 zaiflik                                                                         |
| npm audit --omit=dev              | 0 zaiflik                                                                         |
| git diff --check                  | Muvaffaqiyatli                                                                    |
| Haqiqiy brauzer                   | Chromium, haqiqiy lokal API, yangi disposable MongoDB replica set                 |
| Responsive                        | 320, 375, 390, 600, 601, 700, 701, 768, 1024, 1440 px’da sahifa overflow yo‘q     |
| Klaviatura                        | Checkbox fokus/Space, enrollment saqlash, dialog Escape orqali yopish tekshirildi |

Yangi testlar 12/13/14 darsli oylar, kabisa, same-day/mid-day, chegara vaqti,
effective sanalar, zero lessons, cancellation/reschedule, BigInt rounding,
concurrency/idempotency, preview rollback, RBAC/tenant scope, payment safety,
billed/collected payroll va approved payroll o‘zgarmasligini qamraydi.

Dalillar: [testlar](tests.txt), [yakuniy frontend](frontend-tests.txt),
[build](build.txt), [to‘liq audit](security-audit.json),
[production audit](security-audit-production.json),
[brauzer manifesti](screenshot-manifest.json).

## Skrinshotlar

Barcha ism va moliyaviy ma’lumotlar sintetik. 16-noyabr invoice’i topshiriqdagi
13/7 misol uchun tayyorlangan; yangi enrollment preview’i capture vaqtidagi
haqiqiy server timestamp’idan hisoblangan. Production hisoblariga ulanish bo‘lmagan.

| Ekran                                          | Desktop                                    | Mobile                                    |
| ---------------------------------------------- | ------------------------------------------ | ----------------------------------------- |
| Guruhga qo‘shishdan oldingi preview            | [Ko‘rish](desktop/enrollment-preview.png)  | [Ko‘rish](mobile/enrollment-preview.png)  |
| Hisoblash snapshot dialogi — 13/7, 161 538 UZS | [Ko‘rish](desktop/billing-calculation.png) | [Ko‘rish](mobile/billing-calculation.png) |
| Qo‘lda generatsiya fallback’i                  | [Ko‘rish](desktop/manual-fallback.png)     | [Ko‘rish](mobile/manual-fallback.png)     |

Qayta olish: avval root va `scripts/redesign` dependency’larini `npm ci` bilan
install qiling, `npm run build`, so‘ng
`npx --no-install tsx scripts/phase-6.6.1-capture.mts`.

## Ishga tushirish sharti

PR schedulerning production URL yoki secretini sozlamaydi. Operator
`BILLING_SCHEDULER_SECRET` va scheduler URL’ini tasdiqlangan muhitda sozlagach
kunlik generatsiya ishlaydi. Bayramlar taxmin qilinmaydi; bekor qilish va
ko‘chirish jadval/sessionlarda aniq ifodalanadi. Allaqachon yaratilgan charge
faqat auditli owner tuzatishi bilan o‘zgartiriladi.
