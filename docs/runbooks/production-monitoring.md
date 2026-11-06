# Production monitoring runbook

## Minimal, arzon konfiguratsiya

1. Render health-checkni `/api/ready` ga qo‘ying. Tashqi uptime xizmatida
   `/api/health` (process javobi) va `/api/ready` (MongoDB ping + drain holati) uchun
   60–120 soniyalik probe va ketma-ket 2–3 xatodan so‘ng operator escalation sozlang.
   Readiness faqat `{ready:boolean}`, health faqat `{status:"ok"}` beradi.
2. Mavjud tashqi scheduler POST, HTTPS, alohida Authorization Bearer secret bilan
   ishlasin. Queryga secret qo‘ymang. 202 faqat admission; schedulerning HTTP success
   grafigi delivery success grafigi emas.
3. `MONITOR_SCHEDULER_STALE_SECONDS` ni scheduler intervali + planner/delivery vaqtiga
   yetarli zaxira bilan tanlang: 60 s tick uchun 180 s default; 5 min tick uchun
   600–900 s ma’qul boshlang‘ich qiymat. Platform diagnostikadagi `staleAfterSeconds` ham shu deployment
   konfiguratsiyasini ko‘rsatadi; timestampni shu intervalga nisbatan baholang.
4. `MONITOR_BACKLOG_THRESHOLD=100` boshlang‘ich signal; haqiqiy throughput/SLOga moslang.
   Due backlog quiet-hours/deferred pendingdan farq qiladi; threshold kutilgan kunlik
   piklar bilan kelishilsin. Last completed vaqt uchun tashqi log/incident qoidasi ham kerak.
5. Operatorga tegishli dashboard/API credentialini tashqi public uptime xizmatiga
   bermang. Platform diagnostika mavjud RBAC va MFA/session tekshiruviga bo‘ysunadi.

## Signal va harakatlar

| Signal | Avtomatik mezon | Tavsiya etilgan harakat |
| --- | --- | --- |
| API unavailable | Tashqi /health timeout/non-200 | Render holati va startup_failed log |
| DB unavailable | Tashqi /ready 503; DATABASE_UNAVAILABLE log | DB/networkni tekshirish, queue reset qilmaslik |
| SCHEDULER_STALE | Scheduler secret bor yoki processor avval ko‘rilgan, heartbeat thresholddan eski/yo‘q | Tashqi tick, sleep, DB, oxirgi completed vaqt |
| REPEATED_RUN_FAILURE | consecutiveFailures >= 3 | Planner/processor safe-code loglari |
| DELIVERY_FAILURES | Oxirgi 15 min ichida yangilangan failed/pending errorli joblar >= 10 | Category bo‘yicha sababni ajratish |
| UNKNOWN_OUTCOMES | Oxirgi 15 min ichida yangilangan unknown joblar >= 3 | Qayta yubormaslik, incident review |
| BACKLOG | Ikkala queue due pending yig‘indisi >= threshold | Scheduler/throughput/quiet-hours tekshirish |
| STALE_LEASE | Expired automation/HTTP lease yoki expired sending job bor | Recovery run kutish va unknownlarni review |

`recentFailures` va `recentUnknownOutcome` — hozirgi error statusli, `updatedAt`
so‘nggi 15 daqiqada o‘zgargan **job sonlari**. Bu lifetime event counter yoki har
bir attempt soni emas. Qayta tiklangan eski unknown recent oynadan chiqadi;
umumiy unknownOutcome alohida saqlanadi. Exact bir daqiqadagi rate yoki p95 latency
metrics tizimi qo‘shilmagan. `failuresByCategory` pending retry va failed joblarni
qamrab oladi; sent/cancelled biznes natijalari failure hisobiga qo‘shilmaydi.

## Optional operator Telegram

Sukut bo‘yicha `OPERATOR_ALERTS_ENABLED=false`. Testlar doim mock sender ishlatadi.
**Haqiqiy alert uchun operator tasdig‘i zarur.** Ushbu o‘zgarish hech qanday real
operator yoki customer alert yubormaydi va production env ni sozlamaydi.

Operator alohida bot yaratsin, private chat/groupni tanlasin va a’zolarni tekshirsin.
CRM bot tokenini qayta ishlatish konfiguratsiyada rad etiladi. Private chat ID to‘g‘ri
operatorniki ekanini kod tasdiqlay olmaydi; bu operatorning konfiguratsiya vazifasi.
Botga CRM user/student endpointlari orqali kirish yo‘q, inbound webhook/command yo‘q.
Server secretlarini VITE_ ga qo‘ymang, Gitga yoki screenshotga kiritmang.

```dotenv
OPERATOR_ALERTS_ENABLED=false
OPERATOR_ALERTS_SUPPRESSED=false
OPERATOR_ALERT_COOLDOWN_MINUTES=30
# OPERATOR_TELEGRAM_BOT_TOKEN — secret manager/Render backend env
# OPERATOR_TELEGRAM_CHAT_ID — alohida operator destination
MONITOR_SCHEDULER_STALE_SECONDS=180
MONITOR_BACKLOG_THRESHOLD=100
```

Staging/mock drill va destination reviewdan so‘ng operator enabled=true qilishni
alohida tasdiqlaydi. Suppression=true maintenance paytida barcha outbound alertlarni
bloklaydi; sampled code loglari qoladi. Suppression muddati uchun incident reminder
qo‘ying; bu flagning avtomatik expiry si yo‘q.

Dedup MongoDBda finite code `_id` bilan, cooldown default 30 min (5–1440), global
cap 5 min. Amalda bitta deployment uchun ko‘pi bilan 12 outbound urinish/soat.
Code avval reserve qilinadi, keyin umumiy gate: parallel race/global suppression
ayrim alertni code cooldowni tugaguncha bostirishi mumkin. Bu conservative anti-storm
qaroridir; to‘liq incident logi tashqi kuzatuv uchun saqlanadi. Xato yoki timeout ham
cooldownni sarflaydi, retry va recursive alert yo‘q. Xabar faqat fixed code va runbookni
tekshirish eslatmasidan iborat; CRM payload, identity va credential qo‘shilmaydi.

## In-process monitoring cheklovlari

- Process o‘chsa, uxlab qolsa, OOM yoki event loop hang bo‘lsa monitor ham ishlamaydi.
  Shu sabab API/DB availability alerti tashqi uptime tizimidan kelishi shart.
- DB ishlamasa durable dedup ishlamaydi: in-process Telegram alert yuborilmaydi;
  DATABASE_UNAVAILABLE/MONITOR_FAILED logi va tashqi /ready probe asosiy signal.
- Alohida operator bot queue failuredan mustaqil; Telegram platformasi yoki umumiy
  egress ishlamasa ikkala bot ham ishlamasligi mumkin. Email/uptime providerning
  muqobil kanali talab qilinadi.
- Har 60 s sample; startupdan keyin birinchi sample 60 s dan so‘ng. Qisqa xatolar
  o‘tkazib yuborilishi mumkin. Aggregate query xatosi fail-closed log beradi.
- Process heartbeat jonli bo‘lsa ham planner stuck bo‘lishi mumkin. LastCompletedAt
  uchun deploymentga mos maksimal intervalni operator mustaqil kuzatsin.
- 10 s shutdown va 10 s send timeout orasida persist kafolatlanmaydi. Recovery
  [notification runbook](notification-recovery.md) bo‘yicha unknownlarni saqlaydi.
- Free hosting sleep va tashqi scheduler cheklovlari qat’iy delivery SLA bermaydi.

## Deployment checklist va acceptance

- [ ] Uchala runbook/faza hujjati hamda test natijalari review qilindi.
- [ ] TLS, health-check va tashqi probe/escalation konfiguratsiyasi tasdiqlandi.
- [ ] Scheduler secret alohida, mavjud CRM auth/MFA siyosati o‘zgarmagan.
- [ ] Stale/backlog threshold va quiet-hour piklari kelishilgan.
- [ ] Operator bot private destinationi tekshirildi; alertlar operator roziligigacha o‘chiq.
- [ ] Dedup/cooldown va suppression drill mock bilan o‘tgan.
- [ ] Render restart va DB/Telegram incident drill sintetik stagingda o‘tgan.
- [ ] Production acceptance alohida operator qaydi bilan yopiladi; CI bunga teng emas.

Qo‘shimcha servis qo‘shmasdan boshlang‘ich narx $0 (mavjud API/DB resurslari doirasida).
Pullik worker/monitor SLA zarur bo‘lsa, xarid va tariflar alohida tasdiqlanadi.
