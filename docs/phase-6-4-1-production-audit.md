# SoftLans Edu 2.0 — Phase 6.4.1: production xavfsizlik auditi

Audit bazasi: `origin/main` — `b98c1e2` (2026-11-05 kuni fetch qilingan).
Branch: `feat/phase-6-4-production-audit`. Audit source, lockfile, konfiguratsiya,
hujjatlar va lokal testlarga asoslangan. Jonli Render/Atlas tekshirilmadi;
production MongoDBga ulanilmadi, secretlar o‘qilmadi, deploy/merge bajarilmadi.
Bu penetration test yoki production muhitining xavfsizligini kafolatlash emas.

## 1. Arxitektura ko‘rigi

| Yo‘nalish | Koddagi dalil va baho |
| --- | --- |
| HTTP/hosting | `app.ts`, `frontend.ts`, `server.ts`: Express 5 API va Vite build bir originda, API fallbackdan oldin rezervlangan. Productionda frontend build yo‘q bo‘lsa startup to‘xtaydi. |
| Auth/sessiya | `security.ts`, `validation.ts`, `app.ts`: HS256, issuer/audience, 1 soat, bcrypt cost 12, 72 UTF-8 bayt chegarasi; HttpOnly/Secure/Strict cookie, `/api`, Domain yo‘q. Har so‘rovda DB user/role/active/tenant/sessionVersion tekshiriladi. Logout barcha sessiyalarni bekor qiladi. |
| RBAC/tenant | `tenantScope` Super Admin uchun tenant CRMni ochmaydi. CRM routerlarida rollar, serverdan olingan tenant filtrlari bor; teacher group/attendance/payroll doirasi qo‘shimcha cheklangan. Super Admin faqat platforma metama’lumotlari, agregatlar, tenant holati va SaaS boshqaruviga ega. Tenantni bloklash sessiyalarni bekor qiladi. Cross-tenant bypass tasdiqlanmadi. |
| SaaS/billing | `saas-entitlements.ts`, `saas-service.ts`: muddati server vaqti bilan tekshiriladi, tugagan obuna yozuvlarni 402 bilan to‘xtatadi. O‘qish, auth, owner SaaS va onboarding progress metama’lumoti istisno; center yozuvi istisno emas. Kvota shu resource yaratiladigan tranzaksiyada tenant revision bilan serializatsiya qilinadi. TrialGrant unique tenant indexi trialni takrorlashni to‘sadi. To‘lov tasdiqlash Super Admin, snapshot va idempotency bilan. Narxlar/14 kun o‘zgarmadi. |
| Legacy siyosati | Obunasi yo‘q eski tenantlar ataylab yozish huquqini saqlaydi; bu hujjatlashtirilgan migration siyosati. Yangi ro‘yxatdan o‘tish trialni tranzaksiyada yaratadi. Legacyga avtomatik obuna tayinlanmadi. |
| Input/import | Zod strict DTOlar, ObjectId tekshiruvlari, escaped qidiruvlar. Import: 5 MB fayl, 7 MB JSON, ZIP 20 MB/300 entry, 2000 data qator/32 ustun, formula/active content rad etilishi, child process 128 MB heap va timeout, ko‘pi bilan ikki parser. Batch tenant/user/session/obuna qayta tekshiradi. Bu child process to‘liq OS sandboxi emas. |
| CORS/CSRF/headers | Exact APP_ORIGIN, credentials CORS; brauzer yozuvlari exact Origin va JSON talab qiladi. Helmet CSP/HSTS/nosniff, no-store, server request ID. Telegram webhook va scheduler alohida machine auth bilan browser CSRFdan ajratilgan. |
| MongoDB | `db.ts`: bitta Mongoose ulanishi, strictQuery, 10s selection timeout, autoIndex false, replica-set va session tekshiruvi. `ensureIndexes`: createCollection/createIndexes va insert-only SaaS defaults; startupda xato bo‘lsa HTTP ochilmaydi. syncIndexes/drop yo‘q. Billing/quota/idempotency unique indekslar va tranzaksiyalarga tayanadi. |
| Telegram/scheduler | `telegram.ts`: secret constant-time hash compare, private chat/sender/time oynasi, unique update receipt, hashed expiring link token. Guardian roziligi va tenant/recipient holati yuborish oldidan qayta tekshiriladi. Scheduler alohida bearer secret, qat’iy bo‘sh body/query, Mongo admission lease va interval; 202 yetkazilganini anglatmaydi. |
| CI | `.github/workflows/ci.yml`: PR/main, contents:read, Node 22, npm ci/typecheck/test/build va ikkala audit, 15 min timeout. Deploy qadami yo‘q. Branch protection va Render integratsiyasi repositorydan isbotlanmaydi. |

## 2. Xavflar va severity

Critical: tasdiqlangan topilma yo‘q. High: tasdiqlangan ilova topilmasi yo‘q.
Quyidagi baholar real kod xususiyati va undan kelib chiqadigan shartli ssenariyni ajratadi.

### M1 — Medium: xato logida konkret URL (tuzatildi)

- Komponent: `apps/api/src/errors.ts`.
- Texnik sabab: 500 javob logi `req.path`ni yozardi. Query chiqarilmasa ham URL path foydalanuvchi nazoratida; pathga ism yoki tasodifan secret joylashtirilsa, DB/handler xatosida logga tushardi.
- Ssenariy/ta’sir: server xatosiga uchragan so‘rov shaxsiy qiymatni log retention va log operatorlariga tarqatishi mumkin. Bu productionda ma’lumot sizganining dalili emas.
- Yechim: konkret URL o‘rniga faqat server route template yoki `unmatched`, requestId va method. Body, cookie, query, raw error yo‘q; javob konvensiyasi saqlandi.
- Holat: kod va regression test bilan tasdiqlangan; original kodda ikkala privacy testi yiqildi.

### M2 — Medium: shutdown xato holati va takroriy signal (tuzatildi)

- Komponent: `apps/api/src/server.ts`.
- Texnik sabab: `disconnect().finally(() => process.exit(0))` DB cleanup xatosida ham success exit beradi; finally qaytargan rejected Promise ushlanmagan. SIGTERM va SIGINT uchun alohida once listener bir yopilish jarayonini ikki marta boshlashi mumkin.
- Ssenariy/ta’sir: restart/deployda noto‘g‘ri success diagnostikasi, takror cleanup va rad etilgan Promise; faol so‘rovlarning tugashini baholash qiyinlashadi.
- Yechim: bir martalik guard, HTTP close/DB disconnect xatosida exit 1, allowlist shutdown status logi. 10s maksimal shutdown oynasi saqlandi.
- Holat: original kodga qo‘yilgan yangi testlar yiqildi; success, DB failure, HTTP close failure va ikki signal regressionlari kiritildi. Productionda hodisa bo‘lgani da’vo qilinmaydi.

### M3 — Medium: processga bog‘liq rate limit (qolgan)

- Komponent: `app.ts`, `student-imports.ts`, `saas.ts` va boshqa express-rate-limit sozlamalari.
- Texnik sabab: umumiy/auth limitlari default memory store; restartda reset, replica soni oshsa har birida alohida hisoblagich. Scheduler admissioni bundan mustasno — Mongo orqali umumiy.
- Ssenariy/ta’sir: ko‘p instance yoki restartlarda brute-force/request bosimi uchun umumiy budget ortadi; bitta NAT IPli markazda qonuniy so‘rovlar 429 olishi mumkin.
- Yechim: avval haqiqiy topology/proxy va 429 hajmini tekshirish; zaruratda mavjud edge yoki umumiy store dizaynini alohida tasdiqlash. Bu fazada yangi servis/dependency yo‘q.
- Holat: kod xususiyati tasdiqlangan; jonli replica soni va exploit ehtimoli noma’lum.

### M4 — Medium: restartda fon notification batch uzilishi (qolgan)

- Komponent: `notification-scheduler.ts`, `notification-automation.ts`, `notifications.ts`, `server.ts`.
- Texnik sabab: HTTP 202dan keyin batch web process ichida davom etadi; shutdown HTTPni drain qiladi, fon batchni kutmaydi. Delivery oynasi 45s + planning; shutdown chegarasi 10s. Lease/idempotency/unknown-outcome siyosati mavjud, ammo tashqi Telegram send va DB commit atomik emas.
- Ssenariy/ta’sir: deploy yoki process o‘chishida xabar kechikadi yoki natijasi noma’lum bo‘lib qoladi. 202 yetkazib berish kafolati emas; exactly-once kafolatlanmaydi.
- Yechim: restartdan keyin keyingi trigger, failed/UNKNOWN_OUTCOME kuzatuvi; keyingi fazada vaqt bilan cheklangan drain yoki alohida worker variantini baholash. Noma’lum xabarni avtomatik qayta yuborish qo‘shilmadi.
- Holat: lifecycle koddan tasdiqlangan; jonli yo‘qolgan xabar holati tekshirilmagan.

### L1 — Low: tarixiy deploy hujjatlari va Blueprint

- Komponent: `README.md`, `render.yaml`, `docs/render-demo.md`, `docs/render-free-notification-scheduler.md`.
- Texnik sabab: Blueprint eski `feat/phase-1-foundation`, starter, bir instance, auto-deploy off, demo yopiq registrationni ko‘rsatadi. Eski scheduler hujjati o‘sha audit paytida Free/main/auto-deploy haqida yozgan. Bular hozirgi jonli holatni belgilamaydi.
- Ssenariy/ta’sir: tekshirmasdan Blueprint qo‘llansa eski branch yoki registration siyosati bilan xizmat qayta sozlanishi mumkin.
- Yechim: READMEdagi joriy scope/checkout/deploy izohi yangilandi. Blueprint qiymatlari va tarixiy hujjatlar audit dalili sifatida saqlandi; Dashboard bilan qo‘lda solishtirish kerak.
- Holat: repository tafovuti tasdiqlangan; jonli tafovut noma’lum.

### L2 — Low: webhook avtomatik ro‘yxati bitta demo originga bog‘langan

- Komponent: `telegram-webhook-registration.ts`.
- Texnik sabab: URL `https://softlans-edu-demo.onrender.com/...`ga mahkamlangan; boshqa APP_ORIGINda avtomatik registration `skipped` bo‘ladi.
- Ssenariy/ta’sir: custom domainga ko‘chishda CRM ishlaydi, ammo webhook operator tomonidan moslanmasa bildirishnomalar ishlamasligi mumkin.
- Yechim: domain/bot egasi bilan webhook ko‘chirish rejasini tasdiqlash; auditda URL yoki jonli bot settings o‘zgartirilmadi.
- Holat: koddan tasdiqlangan; hozirgi domain mos kelmasligi faraz, tasdiqlanmagan.

## 3. Amalga oshirilgan tuzatishlar

M1 va M2 minimal backend o‘zgarishlari bilan yopildi. `error-privacy.test.ts` va
`server.test.ts` yangi regressionlarni o‘z ichiga oladi. API status/error javoblari,
public health bodylari, rol/tenant/obuna siyosati va CRM UI o‘zgarmadi. Yangi
dependency, migration, production konfiguratsiya yoki backup job qo‘shilmadi.

## 4. Qolgan xavflar va production to‘siqlari

M3–M4 operatsion nazoratni, L1–L2 qo‘lda konfiguratsiya tekshiruvini talab qiladi.
Quyidagilar **tasdiqlangan zaiflik emas**, yopilmagan assurance savollari:

- **High (shartli ta’sir):** backup/restore ishlamasa ma’lumot yo‘qotish og‘ir bo‘ladi. Haqiqiy Atlas backup tieri, retention, PITR va restore dalili ko‘rilmagan.
- **High (shartli ta’sir):** DB internetga keng ochiq yoki user ortiqcha huquqli bo‘lsa xavf yuqori. Atlas allowlist, TLS, DB user va credential rotation jonli tekshirilmagan.
- Proxy soni, forwarded header overwrite va direct-access holati noma’lum; noto‘g‘ri trust proxy IP limitlarini zaiflashtirishi mumkin.
- Legacy obunasiz tenantlarni yopish alohida business/migration qarori; bu audit ularning huquqlarini o‘zgartirmaydi.
- MFA, parol o‘zgartirish/tiklash va email verification mavjud emas. Ayniqsa platforma operatori uchun recovery/credential yetkazish tartibi talab qilinadi; scope ichida yangi auth oqimi qurilmadi.
- Branch protection, required CI, operator kirish nazorati va secret rotation holati tekshirilmagan.

Real mijozlar uchun launch qarori backup restore dalili, kirish huquqlari va
jonli konfiguratsiya checklisti bilan operator tomonidan yakunlanishi kerak.

## 5. Production konfiguratsiya checklisti

Secret qiymatlarini chat, PR, log yoki screenshotga chiqarmasdan operator tekshiradi:

- [ ] `NODE_ENV=production`; `PORT` platforma bergan qiymat, bind `0.0.0.0`.
- [ ] `APP_ORIGIN` bitta aniq HTTPS origin, slash/path/wildcard yo‘q; frontend/API bir origin.
- [ ] `JWT_SECRET` kamida 48 belgi, tasodifiy va muhitga xos. Rotation barcha sessiyalarni chiqarishi hisobga olingan.
- [ ] `MONGODB_URI` kerakli DB, TLS replica set va least-privilege userga bog‘langan; qiymatni eksport qilib ulashmang.
- [ ] `TRUST_PROXY_HOPS` haqiqiy proxy zanjiriga teng; edge forwarded headerlarni almashtiradi.
- [ ] `DEMO_MODE` / `PUBLIC_REGISTRATION_ENABLED` owner siyosatiga mos. Registratsiya flagi bo‘lmasa demo yopadi, demo bo‘lmasa ochiladi.
- [ ] Telegram sozlamalari backendda; scheduler secret alohida va faqat Authorization headerda. Secret bo‘lmasa endpoint 503 bilan o‘chirilgan.
- [ ] Seed/provision vaqtinchalik credentiallari olib tashlangan; frontendda VITE secret yo‘q.
- [ ] MongoDB unique/TTL indekslari va replica-set tayyorligi tekshirilgan; yangi index konfliktida rollout to‘xtaydi, qo‘lda drop qilinmaydi.

`config.ts` HTTPS origin va secret uzunligini tekshiradi; secret entropiyasini,
Atlas TLS/network siyosatini yoki proxy topology to‘g‘riligini isbotlamaydi.

## 6. Render deployment mulohazalari

`render.yaml` o‘zgartirilmadi va jonli service source of truth deb olinmadi.
Operator Dashboarddagi repository, branch, deployed commit, plan, instance soni,
build/start, auto-deploy va health pathni yuqoridagi tarixiy qiymatlar bilan
solishtirsin. Tavsiya etilgan build: `npm ci --include=dev && npm run build && npm prune --omit=dev`,
start: `npm start`, health: `/api/ready`. Amaldagi mos ekvivalent start commandni
faqat nomi farq qilgani uchun almashtirish shart emas.

PR push qilinganda branch deploy/preview sozlamalari tashqi integratsiyaga bog‘liq;
audit hech qanday deployment buyrug‘ini bajarmaydi. Reviewdan keyingi rolloutda
oxirgi yaxshi artifact/commit va rollback yo‘li tayyor bo‘lsin. Eski binaryga rollback
qilish yangi indeks/default ma’lumotlarni avtomatik qaytarmaydi. Free sleep/cold start
va cron intervali bildirishnoma kechikishiga ta’sir qilishi mumkin; haqiqiy plan noma’lum.
Startup indekslari o‘sib boruvchi DBda vaqt/huquq talab qiladi; o‘zgarishlarni stagingda sinash kerak.

## 7. MongoDB backup va recovery tavsiyalari

- Atlas mavjud tarifining backup imkoniyatini, snapshot/PITR retentionini va xarajatini owner tekshirsin; yoqilgan deb taxmin qilinmadi.
- Owner bilan RPO/RTO belgilang; alohida izolyatsiyalangan test muhitga restore drill qiling, tenant count va moliyaviy ledger mosligini tekshiring, natija/vaqtni qayd qiling.
- Restore sinovi hech qachon production ustiga yozmasin. Notification worker va Telegram outbound o‘chiq bo‘lsin, real mijozlarga xabar ketmasin.
- Backup shifrlash, saqlash joyi, retention, kirish/audit va credential egasini oldindan tasdiqlang. Productiondan lokal kompyuterga nazoratsiz dump tavsiya qilinmaydi.
- Backup job yoki yangi storage credentiali bu fazada yaratilmagan.

## 8. Monitoring va health

`/api/health` faqat `{status:"ok"}`, `/api/ready` faqat `{ready:boolean}`
(200/503); URI, tenant count yoki config qiymatlarini qaytarmaydi. Request ID
server UUIDsi; xato javob/logni bog‘laydi. Startup diagnostikasi stage va allowlist
categoryni chiqaradi, raw error/stackni emas. Shutdown yangi started/completed/failed
hodisalarini chiqaradi; 10s timeoutdagi majburiy exitni platforma restart logi bilan kuzatish kerak.

Mavjud Render log/metrics orqali 5xx, 429, startup failure, readiness, restart/OOM va
latency trendlarini kuzating. Yangi pullik monitoring kerak emas. Schedulerning
accepted/completed/failed loglari, owner-only `/api/notifications/diagnostics`
heartbeat va failed job holatlari yetarli dastlabki signallar; stale heartbeatni
haqiqiy schedule intervali bilan solishtiring. Secret, cookie, raw body yoki student
PII bilan sintetik monitoring qilmang. Log access/retentionga operator chegarasi qo‘ying.

## 9. Testlar va majburiy qo‘lda tekshiruv

Avvalgi kodga yangi privacy/shutdown regressionlari vaqtincha qo‘yilib tekshirildi:
4 test yiqildi, 10 o‘tdi, 2 unhandled error qayd etildi. Tuzatishlar qayta tiklandi;
bu kutilgan red baseline bo‘lib, productionga taalluqli emas.

Yakuniy tekshiruvlar 2026-11-05 kuni bajarildi; bajarilmay qolgan majburiy lokal buyruq yo‘q.

| Buyruq | Natija |
| --- | --- |
| `npm test` | PASS: API 27 fayl / 403 test, web 19 fayl / 100 test; jami 503 |
| `npm run typecheck` | PASS |
| `npm run build` | PASS; mavjud Vite >500 kB chunk va static/dynamic import ogohlantirishlari, build xatosi yo‘q |
| `npm audit --audit-level=high` | PASS, 0 vulnerabilities |
| `npm audit --omit=dev --audit-level=high` | PASS, 0 vulnerabilities |
| `git diff --check` | PASS |

Coverage manbalari: `integration.test.ts` (unauthorized, JWT expired/forged,
logout/revocation, tenant spoofing, role escalation, CSRF, headers),
`students/groups/billing/attendance/payroll/leads` testlari (cross-tenant resurslar),
`super-admin.test.ts` (platforma/CRM ajratish), `saas*.test.ts` va
`onboarding.test.ts` (trial, subscription, quota race, progress istisnosi),
`student-imports.test.ts` (unsafe input/parser), `notification-scheduler.test.ts`
(machine auth, disabled/malformed/rate/lease), `deployment.test.ts`
(health privacy/proxy/headers), yangi privacy va shutdown testlari.
MongoMemoryReplSet lokal disposable bazalardan foydalanadi; productionga test qilinmadi.
Dependency audit vaqtga bog‘liq registry snapshoti, kelajak xavfsizligining kafolati emas.

Operator uchun majburiy, **bu auditda bajarilmagan** tekshiruvlar:

- [ ] Ikki test tenant/har rol bilan login, copied cookie logout, cross-tenant 404/403; haqiqiy mijoz yozuvlarini o‘zgartirmang.
- [ ] HTTPS cookie, exact Origin, no-store/CSP/HSTS, public health minimal body.
- [ ] Trial tugashi/read-only, owner renewal va platforma cheklovlari stagingda.
- [ ] Render commit/config va Atlas restore drill yuqoridagi checklist bo‘yicha.
- [ ] Scheduler noto‘g‘ri/yo‘q secret rad etilishi, to‘g‘ri trigger 202 va keyingi completion; secretni buyruq tarixiga yozmang.
- [ ] Test rozilikli Telegram hisobida yetkazish/opt-out; webhook current domain va backlog holati. Production tokenni PRga ko‘chirmang.
- [ ] Restart paytida readiness, shutdown va keyingi notification recovery stagingda.

## 10. 6.4.2–6.4.4 keyingi qadamlar

- **6.4.2 — release/recovery:** live config attestatsiyasi, branch protection/CI gates, rollback runbook, approved backup/restore drill va RPO/RTO. Workflow actionsni commit SHAga pin qilishni boshqariladigan yangilash jarayoni bilan baholash.
- **6.4.3 — identity va abuse:** platforma MFA va xavfsiz password recovery/change dizayni, operator credential rotation, haqiqiy traffik asosida proxy/rate-limit/NAT siyosati. Legacy tenant migrationi faqat alohida tasdiqlangan reja bilan.
- **6.4.4 — notification reliability:** scheduler service-level maqsadi, bounded drain/worker tanlovi, stale/failed job alertlari, unknown-outcome runbook va staging load/restart sinovlari. UI yoki yangi CRM funksiyasi scopega kiritilmasin.
