# Phase 6.6.3.2 — boshqaruv P&L va pul oqimi

Bu boshqaruv qarorlari uchun **hisoblash uslubidagi taxmin**. Invoice asosidagi ta’lim haqi avtomatik ravishda qonuniy tan olingan earned revenue emas. Natija sertifikatlangan buxgalteriya foydasi, soliq yoki statut hisoboti emas. Depreciation, soliqlar, inventar, amortizatsiya va to‘liq double-entry ledger joriy qilinmadi.

## Prerequisite va arxitektura

PR [#37](https://github.com/eagleabror/softlans-edu/pull/37) `main`ga `be41564ae65682c91be5c8b7ee6ad0a8ea98fdf7` commit bilan birlashtirilgani GitHub metadata va lokal ancestry orqali tekshirildi. Feature branch shu latest `main`dan yaratildi. Billing/payroll/kassa ledgerlari qayta yaratilmagan.

Ko‘rib chiqilgan manbalar: `billing.ts`, `billing-models.ts`, `billing-calculation.ts`, `payroll.ts`, `payroll-models.ts`, `payroll-calculation.ts`, `cash.ts`, `cash-service.ts`, `cash-models.ts`, `analytics.ts`, `daily-reports.ts`, `FinancialReports.tsx`, `security.ts`, `saas-entitlements.ts` va `app.ts`.

Yangi `management-reports.ts` faqat o‘qiydi. Alohida `ManagementReports.tsx` egaga `/reports/management` sahifasini beradi. Eski `/reports`dagi administratorga ochiq tuition collection analytics o‘z ruxsatida qoladi; unga P&L/payroll/cash ko‘rsatkichlari qo‘shilmaydi. Yangi sahifa eski FinancialReports `Chart`, `reportDates`, UZS formatlash, forest/lime panel/KPI/table/filter uslubi va authenticated CSV yuklash usulini qayta ishlatadi. Guruh jadvali 20 tadan sahifalanadi, CSV barcha qaytgan guruhlarni oladi.

## Hisoblash formulalari

Barcha summalar butun UZS. Har bir qo‘shish `BigInt`da bajariladi, natija `±Number.MAX_SAFE_INTEGER`dan chiqsa `422 TOTAL_LIMIT` qaytadi. Float yoki noto‘g‘ri manba qiymati ham rad etiladi; yaxlitlangan qisman hisobot berilmaydi.

| Ko‘rsatkich | Hisoblash |
| --- | --- |
| Hisoblangan ta’lim haqi | Tanlangan `billingMonth`lardagi bekor qilinmagan `Charge.finalAmount` yig‘indisi |
| Proratsiya | Qayta hisoblanmaydi: billingda saqlangan finalAmount allaqachon lesson-based proration va chegirmani o‘z ichiga oladi |
| Haqiqiy tushum | Davrdagi `Payment.paidAt` summalari − davrda qaytarilgan `PaymentReversal.createdAt` summalari |
| Qarzdorlik | Davr oxirigacha barcha hisob oylari bo‘yicha har bir faol Charge uchun `max(0, finalAmount − amaldagi payments)` yig‘indisi; qaytarish cutoffdan keyin bo‘lsa eski qarzni o‘zgartirmaydi |
| Tasdiqlangan maosh xarajati | Tanlangan `payrollMonth`dagi `approvedAt <= asOf` va bekor qilinmagan Payroll.finalSalary |
| To‘langan maosh | Davrdagi SalaryPayout.paidAt − davrdagi SalaryPayoutReversal.createdAt; payroll oyidan mustaqil |
| Operatsion xarajat | Tasdiqlashga tegishli asl expense CashMovement mavjud Expense.amount, expenseDate davrida; faqat snapshot tasnifi `operating`; minus davrdagi expense_void |
| Taxminiy natija | Hisoblangan ta’lim haqi − tasdiqlangan maosh − operatsion xarajat; faqat zarur avtomatik tekshiruvlar o‘tsa |

Payment hamda SalaryPayout o‘z manbasida bir marta hisoblanadi; ular bilan bog‘langan CashMovement P&Lga ikkinchi marta qo‘shilmaydi. SalaryPayout oddiy Expense emas. Charge yoki payroll draft kassa kirimi/chiqimi emas. Haqiqiy tushum kassa qoldig‘i bilan teng bo‘lishi shart emas: hisobsiz tarixiy Payment ham mavjud to‘lov hujjatidir, ammo kassa allocationi yo‘q.

Kelgusi oy Charge hisobiga oldindan kelgan Payment ham o‘z paidAt davrida tushumdir; kelgusi billingMonth joriy davr billed yoki debtiga qo‘shilmaydi.

Guruh bo‘yicha ta’lim haqi Charge.groupIdga, tushum esa tenant/student mosligi tekshirilgan Payment → Charge.groupIdga bog‘lanadi. Guruh foydasi hisoblanmaydi: umumiy xarajat va maoshni guruhlarga sun’iy taqsimlash yo‘q. Eski guruh nomi topilmasa ID va tarixiy label qoladi.

## To‘liqlik va natijani bermaslik

Quyidagilar tegishli oy yoki butun hisobot uchun `estimatedResult: null` qiladi:

- Payroll draft, yo‘q approval, bekor qilingan payroll, salary rule yoki hisoblangan guruh o‘qituvchisi uchun yetishmayotgan payroll.
- Oyda payroll manbalari yoki faol tuition Charge yo‘qligi. Bo‘sh oy nol foyda tasdig‘i emas.
- Tasdiqlanmagan xarajat qoralamasi, snapshot tasnifi yo‘q xarajat.
- Noma’lum manual pul harakati: qarz/egasi mablag‘i yoki oddiy daromad deb taxmin qilinmaydi.
- Manba va kassa summasi/sanasi mos emasligi, yo‘q source/account, ortiqcha payment, yetishmayotgan cash reversal yoki buzilgan transfer juftligi.
- Qisman oy: billed/payroll to‘liq oyga, xarajatlar kunlarga tegishli bo‘lgani uchun shu chegara oyida taxminiy natija berilmaydi. To‘liq ichki oylar o‘z tekshiruvlari bo‘yicha hisoblanadi.

Hisobsiz tarix va boshlang‘ich qoldiq yetishmasligi alohida kassa to‘liqligi ogohlantirishidir; bu accrual taxminining manbasini o‘z-o‘zidan bekor qilmaydi. Bir oy natijasi null bo‘lsa umumiy natija ham null. Barcha manbalar mavjudligi barcha haqiqiy majburiyatlar kiritilganining isboti emas; har qanday raqamli natija ham faqat taxmin.

## Tuzatish siyosati va cutofflar

Timezone barcha davrlar uchun **Asia/Tashkent (UTC+05:00)**. Kunlar yarim ochiq `[start 00:00, end + 1 kun 00:00)` oralig‘ida. API eng ko‘pi 366 kun va kelajakda bo‘lmagan davrni oladi. Tuition/payroll uchun birinchi va oxirgi kun tegishli to‘liq accounting monthlarni tanlaydi; tushum/xarajat/kassa tanlangan kunlarga filtrlanadi.

`asOf` — tizimga **qayd etilgan vaqt chegarasi**, hisobotning end sanasi esa iqtisodiy/kassa davri oxiri. `asOf` kelajakda yoki hisobot end kunidan oldin bo‘la olmaydi. Omitted qiymat server vaqti bo‘ladi. UI tarixiy qayd chegarasi uchun o‘tgan kun oxirini beradi. Bugungi kunning hali tugamagan oxiri future hisoblanadi; current hisobot uchun maydon bo‘sh qoldiriladi.

- Expense: asl tasdiqlangan xarajat expenseDate davrida saqlanadi. Keyingi void **void CashMovement.date** oyida operatsion xarajatni kamaytiradi. Fevraldagi 100 xarajat martda void qilinsa, fevralda +100, martda −100 bo‘ladi. Voided statusning o‘zi asl tasdiqlangan yozuvni oldingi oydan chiqarib yubormaydi. Draft void hech qachon xarajat yoki kassa yaratmaydi. Replacement mustaqil yangi yozuvdir.
- Payment va SalaryPayout: asl to‘lov o‘z paidAt kunida, refund/reversal esa qaytarish qayd etilgan kunida. Oldingi oy receipt/payout raqamlari keyingi refund bilan yo‘qolmaydi. Qarz hisobida cutoffgacha qaytarilmagan paymentlar ishlatiladi.
- Charge tuzatishi/cancellation: asl billingMonthga tegishli restatement. `asOf`dan keyingi eng birinchi ChargeAdjustment.before orqali o‘sha cutoffdagi finalAmount/cancelled tiklanadi. Cancellation asOfdan keyin bo‘lsa oldingi eksportda charge qoladi. Yetarli adjustment.before bo‘lmasa ogohlantirish bilan natija berilmaydi.
- Payroll: tasdiqlangan summa payrollMonthga tegishli. Keyingi oyda berilgan approval yangi asOf bilan payroll oyini to‘ldiradi. Oldingi cutoffda u expense bo‘lmagan. Approvaldan keyin summani o‘zgartirish mavjud payroll API tomonidan ruxsat etilmaydi. `reversedAt`li manba topilsa uning natijasi berilmaydi; yangi statutory correction ledger yaratilmaydi.
- Keyin qayd etilgan backdated payment/expense kassa eski iqtisodiy sanada turishi mumkin. Yangi asOf bilan hisobot yangilanadi; **oldingi asOf** bunday yozuvni chiqaradi. Eksport aynan ko‘rsatilgan hisobotning asOf qiymatini serverga yuboradi; unda policy, start/end, timezone, cutoff, ogohlantirishlar saqlanadi. Yopilgan davrlarni solishtirishda CSVni arxivlash kerak.

Bu to‘liq temporal database emas. Auditdan tashqari raw DB o‘zgarishlarini tiklash qo‘llanmaydi. Guruh/hisob nomi va o‘qituvchi metadata va SalaryRule effective range tarixining barcha revisionlari mavjud emas; eski asOf uchun ular **joriy metadata asosidagi** coverage tekshiruvidir. Immutable CashMovement, Payment/Payout/reversal va mavjud ChargeAdjustment orqali summalar cutoffga olinadi, lekin butun hisobotni barcha mutable metadata bilan abadiy frozen snapshot deb bo‘lmaydi. Production acceptance uchun kerakli CSV arxivlari saqlansin. AsOfdan oldin hali yaratilmagan source/account tabiiy ravishda chiqariladi.

## Pul oqimi va reconciliation

Faqat CashMovement ishlatiladi:

```text
Davr boshi = SUM(delta where date < start and createdAt <= asOf)
Davr oxiri = Davr boshi + boshlang‘ich yozuvlar + ta’lim net kirimi
           + maosh net chiqimi + xarajat net chiqimi
           + tasniflanmagan manual net + transfer net
```

Salary/expense chiqimlari manfiy, reversal musbat; tuition qaytarishi manfiy. Boshlang‘ich qoldiq davrdan oldin bo‘lsa opening ichida, davr ichida bo‘lsa `openingEntries`da ko‘rinadi; revenue emas. Transfers ikkita hisobda qarama-qarshi summada, jami nol; movement_void transferning ikkala oyog‘ini asl sourceId orqali transferga qaytaradi. Juftlik yetishmasa/balans nol bo‘lmasa reconciliation warning beriladi, sun’iy balancing yozuvi yaratilmaydi. Manfiy qoldiq yashirilmaydi.

Manual_in/out va ularning voidlari noma’lum qo‘lda harakat sifatida qoladi; loan proceeds avtomatik daromad emas. Payment/payout allocationi bo‘lmagan qaytarilmagan tarix cutoffga qadar count/amount bilan alohida turadi, cash opening/closingga qo‘shilmaydi. Bu bosqich historical backfill yoki avtomatik allocation yaratmaydi.

Kassa va Payment/Payout summalari hamda original to‘lov kuni solishtiriladi, qaytarilgan allocated source uchun qarama-qarshi cash entry tekshiriladi. Tasdiqlangan expense uchun asl cash source, harakat uchun account/source mavjudligi tekshiriladi. Bu to‘liq bank reconciliation yoki har qanday raw DB buzilishini aniqlovchi audit tizimi emas.

## Xarajat tasnifi va tarix xavfsizligi

Mavjud ExpenseCategoryga `accountingClassification` kelgusi draftlar uchun default sifatida qo‘shildi: `operating`, `capital`, `prepayment`, `unclassified`. Default — unclassified; standart setup nomlaridan ham tasnif taxmin qilinmaydi. Owner create/PATCH amallari sabab, idempotency va CashAudit bilan ishlaydi. Administrator defaultni boshqara olmaydi.

**Yangi Expense draft** kategoriya tasnifi va nomining immutable snapshotini oladi. Eski Expense hujjatlari o‘zgartirilmaydi; snapshot yo‘q bo‘lsa, kategoriya bugun operating bo‘lsa ham eski hujjat unclassified qoladi. Kategoriya defaultini o‘zgartirish avvalgi draft yoki confirmed expensega ta’sir qilmaydi. Oldingi unclassified yozuvlar faqat review ogohlantirishi sifatida turadi; bu bosqich ularni qayta yozish endpointini bermaydi. Kapital xaridi va prepayment P&L operating xarajatiga kirmaydi, ammo haqiqiy cash chiqimi sifatida qoladi. Prepayment release yoki depreciation hisoblanmaydi.

## Ruxsat va xavfsizlik

Faqat `business_owner` uchun `/api/management-reports` va `/api/management-reports/export`. Admin, teacher va super_admin — 403. Super admin uchun cross-tenant ordinary kirish yo‘q. Tenant faqat authenticated principal orqali olinadi; querydagi tenantId strict validation bilan rad etiladi. Tenant reference lookup va source maplar tenant bilan chegaralangan.

Mavjud MFA/device session/sessionVersion/active tenant, secure cookie, Origin/CSRF va subscriptionEntitlement saqlangan. GETlar mavjud subscription read-only siyosatida ochiq; tasnifni o‘zgartirish oddiy subscription write gate ostida. Hisobot GETlari financial write yoki entry yaratmaydi. CSV va JSON `Cache-Control: no-store`. Routerda daqiqasiga 20 so‘rov cheklovi bor. Administratorning avvalgi alohida billing analytics huquqi yangi P&Lga huquq bermaydi.

## Resurs chegaralari

Har bir source query tenant index bilan, zarur month/date/sourceId filtri va kichik projection bilan bajariladi; bitta snapshot transaction ichida ketma-ket o‘qiladi. Har biriga `maxTimeMS: 15000`, `limit: 20001`; 20 000dan ortiq manbada `422 REPORT_LIMIT` va **butun hisobot rad etiladi**. Qisman total ko‘rsatilmaydi. Debt/cash opening uchun davrdan oldingi tarix ham kerak; faqat sana oralig‘ini qisqartirish bunday limitni hal qilmasligi mumkin. Katta tenantlar uchun keyingi alohida loyiha: exact Decimal128 agregatsiya, arxivlash yoki auditlangan opening summary. Ushbu bosqich yashirin batchlarni yoki nazoratsiz ledger scanlarini qo‘shmaydi.

Mavjud tenant/billingMonth, tenant/payrollMonth, tenant/expenseDate, tenant/source reference indexlari qayta ishlatiladi. Qo‘shimcha indexlar: CashMovement `{tenantId,date,_id}` va SalaryPayout `{tenantId,paidAt}`. Oddiy startup `ensureIndexes` yo‘li orqali yaratiladi; productionga ushbu ishda ulanish yoki migration bajarilmadi. Bu cheklov bilan kichik deploymentlar uchun bounded o‘qish amalga oshirilgan, juda katta moliyaviy tarixni to‘liq qo‘llash da’vo qilinmaydi.

## Misol

Fevral: original tuition 2 000, proratsiya 800, chegirma 200 → billed 1 000. Payment 400. Payroll approved 300, payout 120. Operating expense 100. Opening 5 000.

| Hisobot | Fevral |
| --- | ---: |
| Hisoblangan ta’lim haqi | 1 000 |
| Haqiqiy tushum | 400 |
| Qarzdorlik | 600 |
| Tasdiqlangan maosh | 300 |
| To‘langan maosh | 120 |
| Operatsion xarajat | 100 |
| Taxminiy natija (boshqa yetishmovchilik bo‘lmasa) | 600 |
| Kassa oxiri | 5 180 |

Martda 400 payment refund, 120 payout reversal va 100 expense void bo‘lsa: mart receipts −400, salaryPaid −120, operating expense −100; fevral summalari saqlanadi. Fevral oyidagi keyingi 200 payment martda kelgan bo‘lsa, u mart tushumi, fevral billing summasini oshirmaydi. Hisobsiz payment billing/debtga ta’sir qiladi, cash closingga emas. Manual 900 loan-like inflow kassa pulini oshiradi, P&L income bo‘lmaydi va tasnif ogohlantirishini chiqaradi.

## Production acceptance mezonlari

- PR #37 ancestry, barcha test/typecheck/build/audit dalillari va yangi indexlar stagingda tekshirilsin.
- Faqat sintetik staging ma’lumotida owner/admin/teacher/platform/tenant va MFA/session/CSRF/read-only subscription chegaralari tekshirilsin.
- Egasi kategoriyalar uchun kelgusi defaultlarni ongli belgilasin; tarixiy unclassified yozuvlar review ro‘yxatida qolsin.
- Payroll oyma-oy tasdiqlari, invoice completeness, refund/void sanalari, boshlang‘ich qoldiqlar, hisobsiz tarix va manual harakatlar tekshirilsin.
- Test misollaridagi P&L va cash farqi egaga tushunarli bo‘lsin. Qisman/bo‘sh/yetishmayotgan oy uchun foyda o‘rniga to‘liqlik ogohlantirishi chiqsin.
- Tuzatish-period expense siyosati hamda charge/payroll original-period restatement siyosati biznes tomonidan qabul qilinsin. Cutoffli CSVlar arxivlansin.
- Real tarix hajmi 20 000 source limitiga yaqinlashsa, ishlab chiqarishga qabul qilishdan oldin alohida agregatsiya/arxiv yechimi rejalashtirilsin.
- Desktop/mobile tasvirlar va keyboard/filter/export tekshiruvlari [dalillar](../artifacts/phase-6.6.3.2/README.md) bilan taqqoslansin.

Merge/deploy ushbu faza bilan avtomatik bajarilmaydi. Production financial records olinmadi, paid transactions tahrirlanmadi, fake balancing entry va pullik xizmat qo‘shilmadi.

## Yakuniy tekshiruv natijalari

| Tekshiruv | Natija |
| --- | --- |
| To‘liq API testlari | 554 passed, 1 mavjud shartli recovery drill skipped |
| To‘liq UI testlari | 136 passed |
| Yangi moliyaviy testlar | 22 passed |
| Management/expense UI interaction testlari | 10 passed |
| `npm run typecheck` | Passed |
| `npm run build` | Passed; mavjud bundle/import warninglari bor |
| `npm audit --json`, `npm audit --omit=dev --json` | 0 zaiflik |
| Chromium, real API + built UI | 8 screenshot; desktop/mobile, 10 kenglik, filter/asOf/CSV/chart table; 0 JS error |
| `git diff --check` | Passed |

Testlar haqiqiy audit formatiga mos ChargeAdjustment.before.status, actual billing PATCH orqali historical restoration, kelgusi tuition oyiga oldindan tushum, nomuvofiq draft metadata, 20 000 source chegarasi, overflow va tenant/RBAC/MFA/session chegaralarini ham qamraydi. To‘liq loglar [artifacts/phase-6.6.3.2](../artifacts/phase-6.6.3.2/README.md) ichida.
