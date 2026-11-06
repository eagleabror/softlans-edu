# Phase 6.4.4 — Monitoring va notification ishonchliligi

## Ko‘lam va tekshirish chegarasi

Asos: `9da650a` (`main`, Phase 6.4.3.2 MFA merge). CRM, login/MFA,
tenant chegaralari, subscription/trial hisoblari, consent va quiet-hour siyosati
saqlanadi. Yangi UI yo‘q; mavjud himoyalangan API diagnostikasi kengaytirildi.
Production DB, Render konfiguratsiyasi va haqiqiy Telegram xabarlari o‘zgartirilmadi.
Quyidagi tekshiruvlar disposable MongoDB replica set va mock Telegram bilan sintetik.

## Mavjud lifecycle va tasdiqlangan muammolar

1. Tashqi scheduler alohida Bearer secret bilan `/api/internal/notifications/run`
   chaqiradi. HTTP admission lease: 5 daqiqa, triggerlar oralig‘i: kamida 60 soniya.
   `202 accepted` — jarayon qabul qilingan; **yetkazish tasdig‘i emas**.
2. Automation SaaS in-app reminderlarini, so‘ng Telegram mavjud bo‘lsa guardian va
   owner joblarini idempotent kalitlar bilan rejalaydi. Rejalashdagi bitta xato
   boshqa planner/delivery ishini bloklamaydi; umumiy run esa failed bo‘ladi.
3. MongoDB job: `pending → sending → sent|failed|cancelled`; quiet hours sabab
   `sending → pending` bo‘lishi mumkin. Job lease 60 soniya, Telegram timeout 10 soniya,
   umumiy bot pacing odatda 1100 ms. Consent, revision, tenant va source qayta tekshiriladi.
4. Aniq Telegram 429/5xx javoblarida mavjud backoff va besh attempt chegarasi ishlaydi.
   Transport timeout yoki lease muddati tugashi `failed/UNKNOWN_OUTCOME` bo‘ladi.
   Telegram idempotency kalitini qabul qilmaydi; avtomatik yoki oddiy manual retry taqiqlangan.
5. Legacy `TelegramDelivery` dispatcher alohida durable navbat, ayni bot pacing bilan;
   automation uni consume qilmaydi. Monitoring ikkala navbatni alohida jamlaydi.

Oldingi kodni tekshirishda aniqlangan va regressiya testlari bilan yopilgan holatlar:

| Holat | Oldingi xatti-harakat | Yangi xatti-harakat |
| --- | --- | --- |
| 202 dan keyingi restart | HTTP yopilgach background ish shutdown tomonidan kutilmasdi | Signal, tracked task, drain va timeout log |
| CLI va HTTP automation bir vaqtda | HTTP gate CLI ni qamramasdi; processor state ustiga yozilishi mumkin edi | Umumiy `automation` lease, runId fencing |
| Sekin planner | Heartbeat faqat bosqichlar orasida | Har 15 soniyada renewal va heartbeat |
| Eski processor lease tugab qaytsa | Faqat job lease himoyasi | Run ownership va job lease yuborish oldidan tekshiriladi |
| Eski bot permit egasi qaytsa | Yangi egasining pacing muddatini o‘zgartirishi mumkin edi | Permit leaseId orqali release/update fencing |
| DB socket connected, buyruq ishlamaydi | `/ready` faqat readyState tekshirardi | Bounded ping, cached/coalesced probe, 503 |
| Restartdan qolgan run | Faqat stale heartbeat | Keyingi run avvalgi uzilishni va interruptedRuns ni qayd etadi |

## Arxitektura va o‘zgarishlar

```text
External scheduler → authenticated HTTP gate → tracked automation
                                              ↓
CLI automation ─────────────────────→ Mongo automation lease (5 min)
                                              ↓ renew/heartbeat (15 sec)
                          existing planners → durable jobs → Telegram

External uptime probe → /api/health + /api/ready
API monitor (60 sec) → safe aggregate snapshot → fixed alert codes
                                              ↓ Mongo dedup/cooldown
                                    separate operator Telegram bot
```

Lease yangilashda `_id + leaseId + leaseUntil > now`, state yozishda `runId`,
job yakunlashda `_id + sending + leaseId` ishlatiladi. Expired run qayta tiriltirilmaydi.
Lease yangilanishi muvaffaqiyatsiz bo‘lsa keyingi side effect boshlanmaydi.
Bot pacing gate ham alohida permit egasiga bog‘landi. Legacy yuborishda ham job
lease yuborishdan oldin tekshiriladi; expired job natijasi konservativ unknown bo‘ladi.

SIGTERM/SIGINT yangi triggerlarni 503 bilan rad etadi, readiness false bo‘ladi,
monitor to‘xtaydi, yangi delivery boshlanmaydi. In-flight Telegram chaqiruvi natijasini
persist qilishga imkon beriladi. MongoDB tracked ishlar tugamaguncha uzilmaydi.
10 soniyalik hard budget tugasa `shutdown/interrupted/DRAIN_TIMEOUT`, activeJobs va
exit 1 qayd etiladi; completed log chiqmaydi. Toza drain bilan shutdown completed
faqat jarayonning yopilganini bildiradi, barcha xabarlar yetkazilganini bildirmaydi.
Automation alohida `interrupted` holatini va oxirgi failure vaqtini saqlaydi.

## 45 soniya, 10 soniya va uzilish oynasi

45 soniyalik **delivery sikli** budjeti saqlandi; bu butun run uchun timeout emas.
Plannerlar va bitta in-flight DB/Telegram chaqiruvi bu muddatni oshirishi mumkin.
Shutdownning 10 soniyalik budjeti Telegramning 10 soniyalik timeoutidan persist
uchun kafolatlangan zaxira qoldirmaydi. OS kill, event-loop pause, DB javobi yo‘qolishi,
Telegram qabul qilishi va `sent` yozilishi orasida uzilish mumkin. Yakunlanmagan
`sending` lease tugagach `UNKNOWN_OUTCOME` bo‘ladi; bu xabar yuborilmaganini isbotlamaydi.
Yuborish boshlanmagan ayrim uzilishlar ham ehtiyot chorasi sifatida unknown bo‘lishi mumkin.

Hard kill 202 dan keyin, planner job yaratishidan oldin bo‘lsa, hali yaratilmagan job
uchun durable kafolat yo‘q: keyingi scheduler tick mavjud planner retention oynalari
ichida uni qayta rejalashi kerak. Mavjud durable pending joblar esa saqlanadi.
Heartbeat processning jonliligini bildiradi; plannerning biznes progressini isbotlamaydi.
Uzoq planner lease ni yangilab turishi mumkin; completed-run vaqtini ham kuzatish shart.

## Diagnostika va xavfsizlik

- `/api/notifications/diagnostics`: faqat `business_owner`, o‘z tenantidagi `queue`;
  mavjud target diagnostikasi tenant/source RBAC bilan saqlanadi. Global job sonlari berilmaydi.
- `/api/super-admin/notification-diagnostics`: mavjud platform RBAC, haqiqiy
  tenantId=null hisobi va amaldagi session/MFA siyosati. Query override qabul qilinmaydi.
  Global counts, lastCompletedAt, lastFailedAt, heartbeat, stage, interruptedRuns,
  consecutiveFailures, automation lease holati va ikkala queue jamlanmasi beriladi.
- Categorylar qat’iy: unknown_outcome, rate_limited, telegram_server,
  telegram_rejected, eligibility_check, other. Raw errorCode javobga chiqarilmaydi.
- Loglar event, stage, safe code, son va boolean bilan cheklangan. Talaba, tenant,
  Telegram ID, xabar matni, DB URI, credential yoki raw Error/stack yo‘q.
- Aggregate querylar 3 soniyalik server budjeti bilan; platform endpoint mavjud rate
  limiterga bo‘ysunadi. Katta tarix bilan query narxini kuzatish kerak; scanlar cheksiz
  o‘suvchi tarixda qimmatlashadi. Yangi tashqi metrics ombori qo‘shilmadi.

## Alertlar va konfiguratsiya

Batafsil: [production-monitoring runbook](runbooks/production-monitoring.md).
In-process monitor har 60 soniyada sample oladi. Operator alertlari odatda o‘chiq.
Operator tasdig‘isiz ularni yoqish yoki real test yuborish mumkin emas.
Alohida bot tokeni va faqat operatorlar a’zo bo‘lgan private chat/group talab qilinadi.
Chat ID ning haqiqiy egasini kod aniqlay olmaydi: operator a’zolikni qo‘lda tekshiradi.
CRM HTTP API dan bot/destination/message o‘zgartirib bo‘lmaydi.

MongoDB dedup, har code uchun 30 daqiqalik cooldown va barcha code uchun 5 daqiqalik
umumiy limit bor. Bir urinish hatto timeout bo‘lsa ham cooldownni sarflaydi.
Suppression barcha real alertlarni to‘xtatadi. Alert yuborish asosiy CRM navbatidan
mustaqil, qayta queue qilinmaydi, o‘z xatosidan yangi alert tug‘dirmaydi.
DB ishlamasa dedup kafolati uchun direct alert yuborilmaydi; tashqi `/ready` probe kerak.

## Deployment va taxminiy xarajatlar

Yangi servis, paid dependency yoki deployment avtomatik yaratilmaydi. Hozirgi Render
API + MongoDB + tashqi scheduler saqlanadi. Qo‘shimcha in-process kod va Telegram
operator boti uchun alohida servis narxi $0; API/DB resurs sarfi mavjud tarif ichida
bo‘lishi yoki o‘sishi mumkin. Tashqi uptime xizmatining bepul tarifi bilan boshlash mumkin
(limit, polling va yetkazish kanallarini operator tekshiradi). Sleep qiluvchi free API
monitor ticklarini o‘tkazib yuboradi; uptime probe ham SLO kafolati bermaydi.

Alohida worker varianti: API faqat durable job yaratadi; doimiy worker MongoDB
lease bilan shu processorni consume qiladi; workerning o‘z shutdown/grace va tashqi
heartbeat monitori bo‘ladi. Redis yoki yangi queue shart emas. Render worker uchun
rejalash taxmini oyiga $7–25+ (instance/resursga qarab), mavjud DB xarajatlari qo‘shimcha
bo‘lishi mumkin. Bu narx taklifi emas: amaldagi tarif va limitlarni xarid oldidan tekshirish
kerak. Worker web restart xavfini kamaytiradi, Telegram exactly-once muammosini bartaraf
etmaydi. Operator tasdig‘isiz worker yoki pullik monitoring qo‘shilmaydi.

## Rollout va rollback tartibi

1. Operator deploymentni tasdiqlagach tashqi scheduler/CLI triggerlarini vaqtincha
   pause qilsin; durable joblarni o‘chirmasin. Operator alertlarini maintenance
   vaqtida suppressed qoldirsin yoki enabled=false holatini saqlasin.
2. Eski instance ishini drain qiling. Rolling deploymentda eski kod yangi umumiy
   automation/permit fencingni bilmaydi; eski va yangi processorni parallel yuritmang.
3. Yangi API uchun mavjud `ensureIndexes` ishlaydi; yangi alert state `_id` indeksi
   MongoDBning odatiy unique indeksidir. Destructive migration yoki job reset yo‘q.
4. Readiness va RBAC diagnostikasini tekshirib scheduler triggerlarini tiklang.
   Stale lease muddati tugashini kuting; 202 dan keyin heartbeat va lastCompletedAt
   o‘sishini alohida tasdiqlang. Credentiallarni curl command historyga yozmang.
5. Unknown joblar saqlanganini ko‘rib chiqing. Approval bo‘lmasa real operator alertini
   yoqmang; haqiqiy recipientga test notification yubormang.
6. Rollback zarur bo‘lsa triggerlarni yana pause qilib yangi processni drain qiling,
   avvalgi releasega qayting. Qo‘shimcha metadata/indexlarni o‘chirish shart emas.
   Rollback eski shutdown/observability cheklovlarini qaytaradi; unknown joblarni
   avtomatik retryga aylantirish hech qaysi rollback bosqichiga kirmaydi.

## Production acceptance mezonlari

- [ ] Kod review va CI o‘tgan, deploy alohida tasdiqlangan.
- [ ] Render health-check `/api/ready`, tashqi health+ready uptime monitoring sozlangan.
- [ ] Scheduler intervaliga mos stale threshold, xavfsiz Bearer header va tick tarixi tekshirilgan.
- [ ] Replica set/indexlar va RBAC/MFA bilan diagnostika tekshirilgan.
- [ ] Stagingda disposable/synthetic job bilan restart, DB outage va mock 429/timeout drill o‘tgan.
- [ ] 202 delivery sifatida talqin qilinmaydi; completed-run bilan sent job alohida kuzatiladi.
- [ ] Unknown outcome qayta yuborilmasligi va incident egasi/escalation kanali kelishilgan.
- [ ] Operator bot/chat a’zolari, secret storage, suppression va cooldown ko‘rib chiqilgan.
- [ ] Real operator alerti faqat operatorning alohida tasdig‘idan so‘ng sinovdan o‘tgan.
- [ ] Free-tier sleep, 10-second shutdown oynasi va tashqi monitor cheklovlari qabul qilingan.

## Tekshiruv natijalari

2026-11-06 kuni shu workspace ichida bajarildi:

| Buyruq | Haqiqiy natija |
| --- | --- |
| `npm test` | PASS: API 485 passed, 1 skipped; web 116 passed (jami 601 passed) |
| `npm run typecheck` | PASS: API va web |
| `npm run build` | PASS: barcha workspace; mavjud frontend chunk/dynamic-import warninglari bor |
| `npm audit --audit-level=high` | PASS: 0 vulnerabilities |
| `npm audit --omit=dev --audit-level=high` | PASS: 0 vulnerabilities |
| `git diff --check` | PASS |
| Yakuniy o‘zgargan yo‘llar uchun focused suite (9 fayl) | PASS: 143/143 |

Skip — mavjud `recovery.test.ts` dagi native encrypted backup/restore drilli:
`DR_DRILL_CONFIRM=synthetic-only` opt-in talab qiladi. Bu fazada u ishga tushirilmadi;
yangi notification recovery testlari skip qilinmagan. Dastlabki tekshiruvdagi server
mock moslashuvi va yangi stale-sender fixture kaliti tuzatilib, yakuniy yuqoridagi
suite qayta muvaffaqiyatli bajarildi. Sintetik test production verifikatsiyasi emas.
