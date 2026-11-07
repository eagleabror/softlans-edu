# Phase 6.5.2 — Scheduler, Telegram va Email operatsion tayyorligi

Tekshiruv: **2026-11-07 UTC**. Haqiqiy mijozlar piloti: **NO-GO**.
Koddagi sintetik PASS natijalari production tayyorligini anglatmaydi.
Production backup owner qarori bilan keyinga qoldirilgan: bu fazada backup
sozlanmadi, production restore bajarilmadi. Ushbu gate bekor qilinmagan.
Backup tasdiqlanmaguncha productionga yo‘naltirilgan schedule’larni faollashtirmang.

## 1. Versiya va tekshiruv chegarasi

- [PR #39](https://github.com/eagleabror/softlans-edu/pull/39) **merged**:
  `2026-11-07T06:15:54Z`, merge SHA **cc4d66b8e4154ac5b54452bbe52182bcff4549d3**.
  P&L tarixiy teacher tuzatishi main’da bor: `payrollTeacherId`, legacy uchun
  group fallback. PR head `b18a283cc808a9c2f164775cb2007b382111e7ab`.
- PR CI [42341567986](https://github.com/eagleabror/softlans-edu/actions/runs/42341567986)
  va merge CI [42346229231](https://github.com/eagleabror/softlans-edu/actions/runs/42346229231)
  — **completed / success**. Lokal audit bazasi ham `cc4d66b8`.
- Operator tasdiqlagan **My Workspace** ichida Render read-only metadata:
  `softlans-edu-demo`, `srv-dbhr2u88v5cc7396t4ng`, Free web service, `main`,
  avtomatik deploy yoqilgan. Deployment **dep-dbnc47142hec73ca1t3g**:
  **live**, SHA `cc4d66b8`, finished `2026-11-07T06:17:54.034726Z`.
  Bu oldindan sodir bo‘lgan deploy; ushbu audit deploy boshlamadi.
- `includePreviews=true` bilan service discovery’da aynan shu repo uchun faqat
  bitta web service topildi; preview o‘chiq, alohida hosted staging topilmadi.
  Boshqa platformada staging yo‘qligini bu isbotlamaydi; lekin **tasdiqlangan
  izolyatsiyalangan hosted staging mavjud emas**. Tashqi schedule sinovlari shu
  nuqtada to‘xtatildi. `demo` nomi uning sintetikligini yoki productiondan
  ajratilganini tasdiqlamaydi.
- Yagona jonli application tekshiruvi: public, read-only
  `GET /api/auth/password-recovery` → **200, `{"enabled":false}`**.
  Email so‘ralmadi; live secretlar yoki customer recordlar o‘qilmadi.
- Billing, payroll va notification **jonli POST endpointlari chaqirilmadi**.
  GitHub workflow dispatch/rerun, tashqi scheduler yaratish, secret/variable
  o‘zgartirish, merge, deploy, pullik xizmat yoki real Telegram/email yuborish yo‘q.

[Ixcham metadata](../artifacts/phase-6-5-2/observations.json).
`render.yaml` tarixiy foundation branch/Starter rejasini ko‘rsatadi; hozirgi
Render holatining manbasi emas. Uni ushbu fazada apply qilmang.
Eski [notification setup hujjati](render-free-notification-scheduler.md)dagi
demo URL, deploy va activation qadamlari ushbu fazaga ruxsat bermaydi; bu hujjatdagi
staging/backup cheklovlari qo‘llanadi.

## 2. Billing scheduler

Manbalar: [workflow](../.github/workflows/tuition-billing.yml),
[router](../apps/api/src/tuition-scheduler.ts),
[batch/charge service](../apps/api/src/tuition-service.ts),
[calendar](../apps/api/src/billing-validation.ts),
[proration](../apps/api/src/billing-calculation.ts).

| Tekshiruv | Dalil / natija |
| --- | --- |
| Auth | `POST /api/internal/billing/run`, alohida `Authorization: Bearer …`; constant-time hash comparison. Secret yo‘q → 503, noto‘g‘ri/cookie-only → 401. Query va ortiqcha body maydonlari rad etiladi, JSON 1 KB, 10/min/IP |
| Sozlamalar | GitHub **variable** `BILLING_SCHEDULER_URL`, GitHub **secret** va Render env `BILLING_SCHEDULER_SECRET`. URL HTTPS, exact `/api/internal/billing/run`; userinfo/query/fragment va redirect taqiqlangan. Host allowlist yo‘q: operator staging hostini tekshirishi shart |
| Jadval | `5 19 * * *` UTC = **har kuni 00:05 Asia/Tashkent**, oylik charge uchun yangi membershiplarni ham ushlaydi. Actions kechikishi/o‘tkazib yuborishi mumkin; aniq daqiqa SLA emas |
| Cursor | Active tenantlar `_id` bo‘yicha, har batch 10 ta; `after` exclusive. `nextCursor=null` tugashni bildiradi. Har tenant alohida transaction: keyingi tenant xatosi oldingi commitlarni qaytarmaydi |
| Dublikat | Tenant billing lock + snapshot/majority transaction + unique `(tenantId,studentId,groupId,billingMonth)`. Mavjud, paid yoki cancelled charge qayta yozilmaydi. Transport noaniqligidan keyin ayni cursor replay qilish mumkin |
| Kalendar | Joriy oy `Asia/Tashkent`; oy chegaralari UTC+05:00. Enrollment dars boshlanishiga teng bo‘lsa kiradi; bir millisekund keyin bo‘lsa kirmaydi. Leap day, yil chegarasi, cancellation va birinchi qisman oy sinovlari bor |
| Xato/retry | Faol owner yo‘q bo‘lsa batch 500; tenantni jim o‘tkazmaydi. Main workflow 429/500/502/503/504 uchun 3 urinish, 60s kutish, fetch timeout 60s; cursorlar orasida 6.5s, umumiy job 15 min, concurrency cancel=false. Main’da thrown transport xatosi qayta urinilmaydi |
| Muvaffaqiyat | Har cursorning committed 200 javobi, valid counts/oy, terminal null va DB coverage talab qilinadi. Actions skipped yoki shunchaki yashil summary yetarli emas |

**Tasdiqlangan nuqson:** main workflow `response.ok` sababli `202` va `{}` kabi
to‘liq bo‘lmagan JSONni success deb oladi; missing cursor ishni erta tugatadi.
Takroriy cursor va batchlar orasidagi oy almashuvi ham tekshirilmaydi.
[Before sinovi](../artifacts/phase-6-5-2/workflow-before.txt): **10 failed / 10 passed**.
Bu endpoint haqiqatan shunday javob bergani haqidagi da’vo emas; success detection
uchun takrorlangan client nuqsoni.

Alohida minimal **draft [PR #40](https://github.com/eagleabror/softlans-edu/pull/40)**,
SHA `f58b3e84684ec2081903c110945ae02ced52f2a5`: faqat workflow va uning regressiya
testi. HTTP 200, to‘liq DTO, bir xil oy, explicit null/progressing cursor va
cheklangan transport retry. [After sinovi](../artifacts/phase-6-5-2/workflow-after.txt):
**20/20 PASS**. PR #40 uchun [Node 22 CI 42347367657](https://github.com/eagleabror/softlans-edu/actions/runs/42347367657)
ham **completed/success**. Cron/opt-in/secret/API/DB o‘zgarmadi. **Merge/deploy qilinmadi**;
hozirgi live workflow hali tuzatilmagan. Oy almashsa fix xato bilan tugaydi,
oldingi batch yozuvlarini rollback qilmaydi; oy oxiri incidentida operator oy
bo‘yicha coverage’ni tekshiradi. Eski oy uchun schedulerga `month` yuborib bo‘lmaydi.

Yangi sintetik drill: 11 active tenant + 1 inactive; beshinchi tenant owner’i
faol emas → 500 va oldingi 4 charge commit. Owner tuzatilgach replay → 6 created,
4 skipped; keyingi cursor → 1 created/null. Parallel replay → 0/0 created,
jami **11 unique charge**, payment/payout **0**, outbound fetch **0**.
[Test](../apps/api/tests/operational-readiness.test.ts),
[natija](../artifacts/phase-6-5-2/operational-tests.txt).

Kuzatilgan tashqi billing run
[42313698490](https://github.com/eagleabror/softlans-edu/actions/runs/42313698490)
— schedule / completed / **skipped**, bajarilgan billing dalili emas.

## 3. Payroll scheduler

Manbalar: [workflow](../.github/workflows/payroll-monthly.yml),
[router](../apps/api/src/payroll-scheduler.ts),
[automation](../apps/api/src/payroll-automation.ts),
[manual API](../apps/api/src/payroll.ts),
[CLI](../apps/api/src/scripts/payroll-monthly.ts).

- `*/15 * * * *` — har 15 daqiqada yopilish siyosatini tekshiradi. Default:
  **keyingi oyning 1-kuni 00:15 Asia/Tashkent**; `PAYROLL_CLOSE_DAY=1..28`,
  `PAYROLL_CLOSE_TIME=HH:mm`. Default target oldingi Tashkent oyi. Hali ochiq
  oy → `PAYROLL_MONTH_OPEN`, siyosat vaqti kelmasa → `not_due`, hech narsa yaratmaydi.
- GitHub variable `PAYROLL_SCHEDULER_URL`: HTTPS exact `/api/internal/payroll/run`;
  GitHub secret va Render env `PAYROLL_SCHEDULER_SECRET`. Billing/JWT/botdan
  alohida; Bearer, strict body/query, 1 KB, 10/min/IP. Cookie scheduler auth emas.
- Har HTTP batch **1 tenant / 10 teacher**; cursor `{tenantId,afterTeacher?}`.
  Tenant qayta boshlanishi inclusive, teacher exclusive; keyingi batchda javobdagi
  oy pin qilinadi. Faol tenantdagi faol teacherlar olinadi, faol owner talab etiladi.
  Salary rule yo‘q/overlap/limit biznes exception’lari `PayrollRunItem`da ko‘rinadi;
  DB/process xatosi completion sifatida yutilmaydi.
- Billing lock + transaction va unique `(tenantId,teacherId,payrollMonth)`;
  mavjud draft/approved/paid yozuv saqlanadi. Teacher cursor replay va manual/scheduler
  concurrency testlari PASS. Completed run schedulerda qayta ochilmaydi; keyin
  qo‘shilgan teacher yoki tarixiy oyni owner alohida tekshiradi.
- Workflow faqat 200, valid status/count/month/cursorni qabul qiladi, repeated
  cursor/incomplete processing va exceptions’da nonzero tugaydi. 3 urinish,
  transport + 429/5xx retry, 60s timeout/kutish, 6.5s pacing, job 30 min.
  `not_due` bilan success — draft yaratilganining dalili emas.
- **Scheduler faqat `status=draft` yaratadi. Approve yoki payout chaqirmaydi.**
  Uch tenant lifecycle sinovida 3 scheduled draft, har biri 64615; draftdan
  payout 409, salary cash movement 0. Owner approval/payout sinovlari faqat
  alohida sintetik manual bosqichda bajarilgan.
- Manual fallback, faqat tasdiqlangan sintetik stagingda: owner sessiyasi bilan
  `POST /api/payroll/automation/run`, JSON `{month:"YYYY-MM",confirmed:true}`;
  `nextTeacher` bo‘lsa `afterTeacher` bilan davom etish. Exact Origin, CSRF,
  subscription/MFA/RBAC saqlanadi. `GET /api/payroll/automation/status?month=YYYY-MM`
  orqali **barcha sahifadagi** exception’larni tekshiring. DB status/attemptlarni
  qo‘lda reset qilmang. CLI `npm run payroll:monthly -w @softlans/api` ham global
  batchdir; productionda bu fazada ishga tushirmang.

Oxirgi kuzatilgan manual workflow
[42346306138](https://github.com/eagleabror/softlans-edu/actions/runs/42346306138),
exact `cc4d66b8` — completed/**skipped**. Avvalgi scheduled
[42324040518](https://github.com/eagleabror/softlans-edu/actions/runs/42324040518)
ham skipped. Secret mavjudligi/mosligi metadata bilan tasdiqlanmadi;
uning qiymatini olishga urinish qilinmadi.

## 4. Telegram: qabul, completion va delivery alohida

Manbalar: [HTTP trigger](../apps/api/src/notification-scheduler.ts),
[automation](../apps/api/src/notification-automation.ts),
[queue](../apps/api/src/notifications.ts),
[legacy staff queue](../apps/api/src/telegram-delivery.ts),
[diagnostics](../apps/api/src/notification-diagnostics.ts),
[recovery runbook](runbooks/notification-recovery.md).

Tashqi scheduler mavjud `POST /api/internal/notifications/run`ni chaqira oladi:
HTTPS, Bearer `NOTIFICATION_SCHEDULER_SECRET`, JSON `{}`. Secret yo‘q → 503;
cookie/webhook secret/query auth emas. Tenant, recipient, job yoki text override
qabul qilinmaydi. Bu **barcha tenantlarning due ishlarini** uyg‘otadi; bitta
recipientni test qilish parametri emas. Hosted staging va send ruxsatisiz ishga tushirmang.

HTTP admission Mongo lease bilan kamida 60s oralatadi, crash lease 5 min.
CLI/HTTP uchun alohida umumiy run lease, 15s heartbeat va per-job/send fencing
bor. Saas → guardian → owner planning; Telegram sozlanmagan bo‘lsa in-app
SaaS ishlashi mumkin, Telegram jo‘natilmaydi. Planningdan keyin delivery budjeti
45s, 1.2s pacing; bu barcha backlog shu run’da tugash kafolati emas.

| Holat | Nimani isbotlaydi / operator tekshiruvi |
| --- | --- |
| `202 {status:"accepted"}` | Faqat fon ishi qabul qilindi; process restart bo‘lishi mumkin |
| `202 {status:"already_running_or_rate_limited"}` | Yangi run boshlangani ham tasdiqlanmagan; immediate retry storm qilmang |
| Processor completed | Owner diagnostics’da `processor.stage=completed`, `lastCompletedAt` triggerdan keyin o‘sgan, run logida completed; heartbeat/recent yolg‘iz yetarli emas. Queue backlog alohida tekshiriladi |
| Job `sent`, `sentAt`, `SENT` | Provider javobi muvaffaqiyatli va natija DBga persist bo‘lgan. Recipient o‘qiganini isbotlamaydi; real delivery gate uchun rozilikli operator chatidagi xabar dalili ham kerak |
| Job `failed`, `TELEGRAM_400/403` va boshqalar | Aniq provider rejection/attempt tugashi. 429 va aniq 5xx bounded backoff/retry_after bilan ko‘pi bilan 5 attempt; consent/quiet hours har sendda qayta tekshiriladi |
| `failed + UNKNOWN_OUTCOME` | Timeout/transport exception yoki expired sending lease: xabar yetgan bo‘lishi mumkin. **Avtomatik resend yo‘q, manual retry rad etiladi**. Status failed’ni “aniq yetmagan” deb olmang |
| `OUTCOME_NOT_PERSISTED` / interrupted | Sendning DB natijasi yoki run tugashi noaniq; keyingi lease recovery unknown’ni saqlaydi. Operator tekshiruvisiz yangi nusxa yaratish ham mumkin emas |

Sintetik sender bilan real pending job HTTP triggerdan `sent`ga o‘tdi,
attempt=1; persisted processor **completed + lastCompletedAt** ham tekshirildi.
[11/11 natija](../artifacts/phase-6-5-2/notification-completion.txt).
Transport unknown’ni avtomatik qayta yubormaslik, expired lease/manual retry 409,
429/backoff/attempt limit, tenant/consent/shutdown testlari asosiy 137 test ichida PASS.
Bu mockdagi yetkazish; **haqiqiy Telegram yuborilmadi**.

`telegram:automation` — ushbu guardian/owner/SaaS processor; eski
`telegram:dispatch` — staff queue, uning o‘rnini bosmaydi. Web Start Command’ni
CLIga almashtirmang. Tashqi HTTP scheduler konfiguratsiyasi/egasi/tick tarixi
o‘qilmadi, tashqi completion **NOT VERIFIED**.

## 5. Password recovery email

Manbalar: [adapter](../apps/api/src/password-email.ts),
[security](../apps/api/src/password-security.ts),
[config](../apps/api/src/config.ts),
[batafsil contract](phase-6-4-3-1-password-security.md).

Provayder tanlanmadi yoki xarid qilinmadi. Amaldagi contract:

```text
POST PASSWORD_EMAIL_ENDPOINT
Authorization: Bearer (server-side PASSWORD_EMAIL_API_KEY)
Content-Type: application/json
JSON fields: from, to, subject, text
```

Gateway oddiy SaaS endpointi bilan bir xil bo‘lishi shart emas; operator tanlagan
provider shu contractni qabul qilishi yoki tasdiqlangan HTTPS gatewayda moslanishi
kerak. URL HTTPS, userinfo/query/fragment yo‘q; redirect taqiqlangan; timeout 10s;
TLS tekshiruvi o‘chirilmaydi. API key kamida 32 belgi, alohida backend secret.
`PASSWORD_EMAIL_FROM` valid va providerda tasdiqlangan email bo‘ladi.

- 2xx — **gateway acceptance**, inbox delivery emas; body loglanmaydi, stream
  bekor qilinadi. Non-2xx/network/timeout xato, avtomatik retry yo‘q.
- `PASSWORD_RECOVERY_ENABLED=false`, `PASSWORD_EMAIL_DELIVERY_VERIFIED=false`
  tasdiqsiz holatda saqlanishi kerak. Enabled=true lekin verified/provider
  yetishmasa startup fail-closed. Flagning o‘zi delivery dalili emas.
  Jonli public GET recovery hozir disabled ekanini tasdiqladi; qolgan env
  qiymatlari o‘qilmadi, `VERIFIED`ning live qiymati da’vo qilinmaydi.
- Forgot valid emailga generic 202 beradi — hisob mavjudligi va delivery holatini
  oshkor qilmaydi. Reset token 32 random byte, DBda SHA-256 hash; 15 min, single-use,
  yangi request eskisini bekor qiladi. Send failure aynan o‘sha tokenni tozalaydi.
  Reset sessionVersionni oshiradi, eski sessiyalar rad etiladi; Super Admin public
  recovery taqiqlangan. Email fon ishi durable emas: restartda yo‘qolishi mumkin.
- URL faqat `APP_ORIGIN/reset-password#token=…`dan; gateway/providerdagi click
  tracking, URL rewrite, body logging va analytics o‘chiriladi. Token/parol/hash,
  raw body, recipient yoki Authorizationni report/log/HAR/screenshotga yozmang.
- [Asosiy suite](../apps/api/tests/password-security.test.ts)dagi token consumption,
  expiry, race, tenant/session/privacy hamda yangi mocked gateway 302/400/401/403/
  429/500/503, timeout/transport va 202 testlari PASS. 10 mocked outcome uchun
  aynan 10 fetch: avtomatik retry yo‘q. Bu haqiqiy provayder TLS/DNS/inbox testi emas.

**Keyingi ruxsatli integratsiya tartibi:** avval izolyatsiyalangan hosted staging
va operator tanlagan gateway/provider, xarajat/egalik qarori, SPF/DKIM/DMARC,
tasdiqlangan FROM va rozilikli test inbox bo‘lsin. Ikkala recovery flag false
paytda gateway orqali zararsiz, tokensiz test xabari faqat alohida ruxsat bilan
yuborilib, actual inbox/spam va bounce natijasi qayd etiladi. Gateway 2xx bilan
to‘xtamang. Haqiqiy ruxsatli inbox dalilisiz `DELIVERY_VERIFIED=true` qo‘ymang.
Shu dalildan keyingina operator **stagingda** verified flagini, so‘ng recovery’ni
yoqib actual forgot → inbox link → reset 204 → shu token bilan qayta urinish
400 → eski sessiya 401 → yangi login jarayonini tekshiradi. Dalilda faqat vaqt,
release, cheklangan delivery receipt va natija saqlansin; reset link/PII emas.
Expiry, noto‘g‘ri token va tenant/session himoyalari ham qayta tekshiriladi.
Bu bosqichlar ushbu auditda bajarilmadi; production recovery’ni yoqmang.

## 6. Operator uchun bosqichma-bosqich konfiguratsiya checklisti

### A. Hozirgi to‘xtash sharti

1. Qarorni **NO-GO** deb qoldiring. Backup keyinga qoldirilgani uchun bu fazada
   backup setup/restore rejasini bajarmang va backup gate’ni PASSga almashtirmang.
2. Tasdiqlangan hosted staging bo‘lmasa **tashqi schedule yoki Test now/Run workflow
   tugmasini bosmang**. Hozir aynan shu cheklov mavjud. Faqat quyidagi lokal
   sintetik sinovlar va konfiguratsiya rejasini ko‘rib chiqish mumkin.
3. Productionni ko‘rsatuvchi GitHub URL variablelarini qo‘shmang, tashqi jobni
   enable qilmang. Mavjud remote env/secretlar bu auditda o‘zgartirilmadi.
   Oldingi schedule mavjud bo‘lsa operator uning destination/holatini qiymatlarni
   oshkor qilmasdan ko‘rib chiqsin; ushbu hujjat production tickiga ruxsat emas.

### B. Render — faqat keyinchalik tasdiqlangan staging uchun tayyorlash

1. Alohida service/DB/credential va sintetik tenantlar izolyatsiyasini operator
   tasdiqlasin: production DBga kirish huquqi bo‘lmasin; production bot/inboxlar
   ulanmasin. Pullik servisni bu vazifa doirasida ochmang.
2. Release SHA, Node 22.12+, `/api/ready`, replica set/session support va kerakli
   unique indexlarni stagingda tekshiring. Build `npm ci --include=dev && npm run
   build && npm prune --omit=dev`, Start `npm start -w @softlans/api` — faqat
   reja sifatida; hozirgi production command/env/deploy o‘zgartirilmaydi.
3. Staging env kalitlari: `NODE_ENV`, exact HTTPS `APP_ORIGIN`, faqat sintetik
   `MONGODB_URI`, alohida `JWT_SECRET`, mos `TRUST_PROXY_HOPS`,
   `PUBLIC_REGISTRATION_ENABLED=false`. Mavjud MFA talablarini pasaytirmang.
4. Har biri mustaqil random 43–128 belgili secret:
   `BILLING_SCHEDULER_SECRET`, `PAYROLL_SCHEDULER_SECRET`,
   `NOTIFICATION_SCHEDULER_SECRET`. Secret yo‘qligi endpointni o‘chiradi;
   bo‘sh string bilan konfiguratsiya startup validationdan o‘tmasligi mumkin.
   Qiymatlarni faqat operator password manager/Render secret fieldida boshqarsin.
5. Payroll uchun `PAYROLL_CLOSE_DAY=1`, `PAYROLL_CLOSE_TIME=00:15` rejasini tasdiqlang.
   `PAYROLL_MONTH` faqat CLI catch-up, Actions manual inputi esa `month`.
6. Mock testlarda bot shart emas. Real Telegram testi faqat yangi aniq operator
   ruxsati bilan alohida staging bot/consenting test chat: `TELEGRAM_BOT_TOKEN`,
   `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`. `OPERATOR_ALERTS_ENABLED=false`
   qolsin; tasodifiy alert yuborishga ham ruxsat berilmagan.
7. `MONITOR_SCHEDULER_STALE_SECONDS` default 180, `MONITOR_BACKLOG_THRESHOLD`
   default 100. Interval + planning/delivery davomiyligini hisobga oling.
8. Email kalitlari: `PASSWORD_EMAIL_ENDPOINT`, `PASSWORD_EMAIL_API_KEY`,
   `PASSWORD_EMAIL_FROM`; ikki flag false. Haqiqiy tasdiq tartibi 5-bo‘limda.
   Secretlarni `VITE_`ga, Gitga, chatga, screenshot yoki logga qo‘ymang.

### C. GitHub Actions — stagingdan boshqa URLga tegmang

1. Settings → Secrets and variables → Actions’da **variable** nomlarini
   tekshiring: `BILLING_SCHEDULER_URL`, `PAYROLL_SCHEDULER_URL`.
   Bo‘sh/mavjud emas bo‘lsa workflow job skipped. Skippedni success deb qabul qilmang.
2. Kelajak tasdiqlangan staging URLlari mos ravishda
   `https://<STAGING_HOST>/api/internal/billing/run` va
   `https://<STAGING_HOST>/api/internal/payroll/run`; query/trailing slash yo‘q.
   **Bu variablelar cronni ham opt-in qiladi**, faqat manual test sozlamasi emas.
   Hosted staging va vaqt/xarajat/send nazorati tasdiqlanmasdan ularni kiritmang.
3. Secret nomlari aynan `BILLING_SCHEDULER_SECRET`, `PAYROLL_SCHEDULER_SECRET`;
   faqat tegishli staging Render credentiali bilan moslashtiring. Qiymatini
   log/terminal argumenti yoki reportga ko‘chirmang; `set -x`/curl verbose yo‘q.
4. PR #40ni reviewer alohida ko‘rib chiqadi. Ushbu faza merge/deployni bajarmaydi;
   hozircha billing client completion gate **FAIL**.
5. Keyingi tasdiqlangan staging run’da Actions → tegishli workflow → Run workflow.
   Payroll uchun yopilgan `month`ni tanlang. Har batch 200/DTO/cursorni kuzating;
   exceptions yoki job timeout bo‘lsa success deb yopmang. Ikkala workflow
   concurrency group/cancel=false himoyasini saqlang.
6. Ikkinchi replaydan keyin charge/draft count o‘zgarmasligi va salary draftdan
   chiqmaganini tekshiring. Run ID, SHA, oy, aggregate counts va terminal cursor
   yozilsin. PII yoki raw DB dumpni artifactga qo‘ymang.

### D. Tashqi notification scheduler — hozir aktiv emas

1. Operator tanlagan existing scheduler’da disabled draft konfiguratsiya rejasi:
   exact staging `/api/internal/notifications/run`, **POST**, `Content-Type:
   application/json`, body `{}`, Authorizationda staging Bearer secret.
   URL/query/basic auth/cookie bilan credential yubormang; redirectni rad eting.
2. Interval kamida 1 min; timezone Asia/Tashkent. 30s HTTP timeoutdan keyin
   resend storm yo‘q. 202da processor va queue holatini alohida tekshiring.
   401/403 — auth/config incident; 503 — readiness/config; 429 — kutish.
3. Hosted staging yo‘q yoki send ruxsati yo‘q bo‘lsa jobni **enable qilmang**.
   Hozir real botli endpointni bir marta sinashga ham ruxsat yo‘q.
4. Keyingi ruxsatli staging drill’da owner `/api/notifications/diagnostics`:
   accepted vaqti, lastStarted/heartbeat/**lastCompletedAt**, stage, due backlog,
   failures/unknown kategoriyalarini kuzatsin. Faqat `recent` yetarli emas.
5. Unknown bo‘lsa automatic/manual resend va bulk resetni to‘xtating;
   mavjud dalilni operator tekshiradi. Real delivered gate uchun alohida ruxsat,
   bitta sintetik test recipient va o‘sha chatda actual xabar tasdig‘i kerak.

### E. Xavfsiz lokal qayta sinash

Repo rootdan, production `.env`/credentiallarsiz disposable checkoutda:

```sh
npm ci --include=dev --ignore-scripts --no-audit --no-fund
npm exec -w @softlans/api -- vitest run tests/billing.test.ts tests/billing-calculation.test.ts tests/payroll.test.ts tests/notification-scheduler.test.ts tests/notification-reliability.test.ts tests/notifications.test.ts tests/password-security.test.ts tests/pilot-financial-lifecycle.test.ts tests/operational-readiness.test.ts
npm run typecheck -w @softlans/api
git diff --check
```

Testlar o‘zlari MongoMemoryReplSet 7.0.24 loopback bazasini yaratadi; tashqi
`MONGODB_URI`ni ulash uchun ishlatmaydi, yakunda disconnect/stop qiladi.
Mongo binary ilk run’da rasmiy manbadan yuklanishi mumkin; bu production access
emas. `seed:dev`, billing/payroll/Telegram CLI yoki production curl POST ishlatmang.
Yangi audit fixture outbound fetchni bloklaydi; email faqat mock orqali.

PR #40 branchida `npm exec -w @softlans/api -- vitest run
tests/scheduler-workflows.test.ts` — actual workflow JS VMda, HTTPS fetch ham
faqat mock, timerlar immediate. Bu tashqi GitHub cron runi emas.

## 7. Acceptance gate’lar va dalillar

PASS aynan ko‘rsatilgan qamrovda; FAIL kuzatilgan mezon bajarilmaganini,
NOT VERIFIED esa amaliy dalil yetishmasligini bildiradi. Barcha mandatory gate’lar
qabul qilinmaguncha haqiqiy pilot **NO-GO**.

| # | Majburiy mezon | Holat | Dalil / qolgan chegara |
| --- | --- | --- | --- |
| 1 | Billing scheduler muvaffaqiyatli tugagan | **FAIL** operatsion | Kuzatilgan external run skipped, main success detector nuqsoni bor. Sintetik real router recovery/cursor **PASS**; PR #40 mock 20/20 PASS, hali merge emas |
| 2 | Payroll scheduler muvaffaqiyatli tugagan | **FAIL** operatsion | Oxirgi manual va scheduled Actions skipped. Sintetik HTTP 3 tenant draft/cursor va payroll suite **PASS**, hosted due completion yo‘q |
| 3 | Charge/payroll draft dublikatlari yo‘q | **PASS — sintetik** | 11-tenant billing partial failure/concurrent replay; payroll manual/scheduler concurrency, teacher cursor restart, 3-tenant lifecycle. Production coverage **NOT VERIFIED** |
| 4 | Notification processor tugagan | **PASS — sintetik** | HTTP accepted → sent job → persisted completed/lastCompletedAt, 11/11 scheduler test. External scheduler/completion **NOT VERIFIED** |
| 5 | Ruxsatli Telegram real yetkazish | **NOT VERIFIED** | Ruxsat berilmagan, xabar yuborilmadi; mock provider success real delivery emas |
| 6 | Ruxsatli email reset link inboxga keldi va consumed bo‘ldi | **NOT VERIFIED** | Real gateway/inbox yuborishi yo‘q. Mock token single-use/expiry/session sinovlari PASS; live recovery public GET disabled |
| 7 | Secretlar va tenant ma’lumoti himoyalangan | **PASS — audit qamrovida** | Synthetic-only DB/mocklar; tenant/RBAC/Origin/privacy testlari PASS, real secret/customer records o‘qilmadi yoki commit qilinmadi. Production konfiguratsiya auditi **NOT VERIFIED** |
| 8 | Production moliyaviy yozuvi bajarilmadi | **PASS — ushbu audit** | Production scheduler POST/CLI/DB ulanishi yo‘q; remote read-only metadata + public boolean GET. Lokal moliyaviy yozuvlar faqat disposable bazada. Mustaqil tashqi runnerlar tarixi attestatsiyasi emas |

Dalillar:

- [Asosiy readiness suite](../artifacts/phase-6-5-2/synthetic-tests.txt): **8 fayl,
  137/137 PASS**, skip yo‘q. Runtime code `cc4d66b8`.
- [Yangi billing/email drilli](../artifacts/phase-6-5-2/operational-tests.txt):
  **2/2 PASS**, alohida yangi sintetik baza.
- [Kuchaytirilgan HTTP → completion tekshiruvi](../artifacts/phase-6-5-2/notification-completion.txt):
  **11/11 PASS**; bu asosiy 137 ichidagi scheduler suite’ining takroriy runi,
  uni yana 11 yangi test deb hisoblamang. Jami **139 distinct readiness test**.
- [Workflow oldin](../artifacts/phase-6-5-2/workflow-before.txt),
  [keyin](../artifacts/phase-6-5-2/workflow-after.txt): separate fix PR 20 test;
  current main bo‘yicha failed baseline ataylab saqlangan.
- [API typecheck](../artifacts/phase-6-5-2/typecheck.txt) PASS; `git diff --check`
  PASS. Lokal Node **24.19.0**, npm **11.9.0**; CI Node **22**. Bu fazada butun
  monorepo regression/build/audit qayta bajarildi deb da’vo qilinmaydi.

## 8. Qolgan blockerlar va egalar

| Blocker | Egasi / yopish dalili |
| --- | --- |
| Production backup unverified, owner-deferred | Owner/DB operator: keyingi alohida fazada gate dalili. Hozir setup/restore yo‘q, gate ochiq |
| Hosted staging tasdiqlanmagan | SRE/owner: alohida repo release, sintetik DB/credentials, bot/destination izolyatsiyasi; shundan oldin external schedule yo‘q |
| Billing completion nuqsoni | Reviewer: alohida PR #40; hozir draft/unmerged. Review/CI o‘tishi deployment yoki pilot uchun avtomatik ruxsat emas |
| Billing/payroll Actions skipped | SRE: keyingi authorized stagingda configured URL/secret mosligi, due batchlar, barcha cursorlar va duplicate replay dalili |
| External notification tick/completion yo‘q | Operator: scheduler egasi, disabled/enabled holat, ruxsatli staging tick, yangi persisted completion va queue terminal holati |
| Real Telegram delivery yo‘q | Owner/operator: aniq send ruxsati, consenting sintetik chat, actual xabar dalili; unknown resend yo‘q |
| Email provider/inbox reset yo‘q | Auth/email operator: provider qarori/HTTPS contract/domain, actual authorized inbox va consumed link dalili. Ungacha recovery disabled |

Owner va operatorlar barcha mandatory gate’lar uchun dalil qabul qilmaguncha
haqiqiy customer pilot qarori o‘zgarmaydi. Ushbu hisobot activation ruxsati emas.
