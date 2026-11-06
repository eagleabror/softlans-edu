# Notification incidentdan xavfsiz tiklanish

## Boshlash

Incident va vaqt oralig‘ini qayd eting; loglarni secret yoki shaxsiy ma’lumot bilan
ko‘chirmang. Owner o‘z `/api/notifications/diagnostics` endpointidan, platform operatori
MFA/session himoyalangan `/api/super-admin/notification-diagnostics` endpointidan foydalanadi.
`queue` va `legacyQueue`, stage, heartbeat, lastCompletedAt/lastFailedAt, leaseActive,
staleLease, due va unknownOutcome ni solishtiring. Global ko‘rinishga talaba ma’lumotini qo‘shmang.

Avval sababni bartaraf qiling. Mavjud owner retry endpointi faqat aniq 429/500/502/503/504,
failed status va attempts<5 uchun ishlaydi. Avtomatik backoff boshqa aniq 5xxlarni ham
besh urinish ichida qayta sinaydi. UNKNOWN_OUTCOME, bloklangan recipient yoki consent
yo‘qolishini oddiy retry bilan chetlab o‘tib bo‘lmaydi. Tenant, kind va quiet-hour siyosati
qayta tekshiriladi. DBda status/attemptsni qo‘lda ommaviy reset qilmang.

## Render restart yoki shutdown

1. Deploy/restart vaqtini `shutdown started`, `interrupted/DRAIN_TIMEOUT` va keyingi
   `startup/listening` bilan moslang. 202 javobini delivery tasdig‘i deb olmang.
2. Pending joblar MongoDBda saqlanganini jamlanmada tekshiring. Yangi instance va
   MongoDB ready bo‘lgach odatiy scheduler tickini kuting. HTTP va automation lease
   5 daqiqagacha bloklashi mumkin; uni erta o‘chirmang.
3. Yangi run oldingi nonterminal stage ni `PREVIOUS_RUN_INTERRUPTED` va interruptedRuns
   bilan belgilaydi. Delivery kelganda 60 soniyadan eski sending job unknown bo‘ladi.
4. Unknown joblarni qayta yubormang. Oxirgi completed vaqt va backlogning tushishini kuzating.

Sintetik drill: `notification-reliability.test.ts` interrupted planning/restart/fencing,
`server.test.ts` drain va 10-second timeout, `notifications.test.ts` expired sending.

## MongoDB vaqtinchalik ishlamasa

1. `/api/health` 200 bo‘lib, `/api/ready` 503 bo‘lishi mumkin. Readiness ping 1.5 s
   client budjeti va 5 s cache bilan ishlaydi. Tashqi probe bilan kamida ikki marta tekshiring.
2. Atlas/Render network va DB service holatini ruxsatli konsolda tekshiring; URI/parolni
   logga yozmang. Connection errorlar raw ko‘rinishda qayd qilinmaydi.
3. Queue/state yozuvi bo‘lmaganida Telegramga yangi jo‘natish boshlanmasligi kerak.
   In-flight send qabul qilingan bo‘lsa natija persist qilinmagan bo‘lishi mumkin.
4. DB qaytgach /ready va odatiy scheduler bilan tiklang. Lease muddati tugasin;
   failed checklar mavjud retry limitidan foydalanadi, ambiguous send unknown qoladi.
5. Database incidentida operator Telegram alerti ham dedupni yo‘qotmaslik uchun yuborilmaydi.
   Tashqi uptime/DB alertidan foydalaning.

Sintetik tekshiruv: readiness rejected ping/disconnection, processor lease renewal
failure/fencing va mavjud notification CHECK_FAILED testlari. Bu haqiqiy Atlas outage drilli emas.

## Telegram 429

1. `rate_limited` kategoriya va `notification_delivery/TELEGRAM_429` ni tekshiring.
2. `retry_after` va exponential delay saqlanadi; umumiy bot pacing ham cho‘ziladi.
   Worker sonini ko‘paytirib rate limitni chetlab o‘tmang.
3. `nextAttemptAt` va besh attempt limitini kuting. Repeated failure bo‘lsa sababni,
   botdan boshqa producerlar ham foydalanayotganini tekshiring.
4. Beshta urinishdan keyingi failed job attempts budgetini reset qilmang.

Sintetik tekshiruv: `notifications.test.ts` va `telegram.test.ts` 429/backoff/attempt limit.

## Telegram timeout yoki UNKNOWN_OUTCOME

1. Timeout, connection reset yoki expired sending lease — yetkazilgan bo‘lishi mumkin.
   Unknown holatni failed-not-delivered deb talqin qilmang.
2. Avtomatik retry, manual retry API yoki bir xil mazmundagi yangi job yaratishni to‘xtating.
   Bot API client-side idempotency va tarixni ishonchli reconcile qilish kafolatini bermaydi.
3. Ruxsatli incident egasi mavjud yetkazish dalillarini tekshiradi; zarur bo‘lsa recipient
   bilan ruxsatli kanal orqali kelishadi. Ushbu kod buning uchun real xabar yubormaydi.
4. Dalil bo‘lmasa unknown saqlanadi. Zarur yangi xabar faqat aniq operator/business
   qarori va audit bilan alohida jarayon; bu release bunday bypass bermaydi.

Sintetik tekshiruv: transport exception, expired lease, retry API 409 va restart
UNKNOWN_OUTCOME preservation. Telegram production yetkazishi tekshirilmagan.

## Stale scheduler lease yoki stuck processing

1. Heartbeat interval/threshold to‘g‘ri ekanini, process uyquda yoki DB unavailable
   emasligini aniqlang. Recent heartbeat planner progressini kafolatlamaydi.
2. lastCompletedAt o‘smay stage bir joyda qolsa logdagi planning/run failurelarni tekshiring.
3. Boshqa egasi ishlamayotganini aniqlamasdan lease ni olib tashlamang. Recovery odatda
   expiry va keyingi scheduler tick orqali amalga oshadi; runId/leaseId fencing saqlanadi.
4. Uzoq planner jonli bo‘lib lease yangilayotgan bo‘lsa ruxsatli restart ishlatilishi mumkin;
   oldin incident dalillarini saqlang. Yangi servis yoki pullik worker avtomatik yaratilmaydi.

Sintetik tekshiruv: lease expiry, successor state/permit fencing, slow-planning heartbeat.

## Takroriy xatolar va o‘suvchi backlog

1. Failure kategoriyasi bo‘yicha ajrating: 429/5xx aniq API javobi, check failure
   pre-send xatosi, 400/403 recipient rejection, unknown esa noaniq natija.
2. Consent/quiet hours, inactive tenant, o‘chirilgan integration va source expiry oddiy
   biznes qoidalari; ularni deliveryni tezlatish uchun chetlab o‘tmang.
3. Due backlog va oldestDueAt ni kuzating; future/quiet-hour joblari alohida pending
   bo‘lib turishi mumkin. Global raw count yolg‘iz incident dalili emas.
4. Tashqi scheduler ticklarini, completed runlarni va bot pacingni tekshiring. Oddiy
   45 s delivery sikli va 1.2 s pause nazariy jihatdan taxminan 37 ta job/run dan kam
   bo‘lishi mumkin; real DB/API latency va permitlar throughputni pasaytiradi.
5. Scheduler admissionni tezlatmang, batch/worker sonini nazoratsiz oshirmang. SLA
   yetishmasa alohida worker arxitekturasini xarajat bilan ko‘rib chiqing.

## Incidentni yopish

Sabab, unknown joblar bo‘yicha qaror, tiklangan readiness, yangi completed run va
kamayayotgan due backlogni qayd eting. Temporary alert suppressionni olib tashlashni
operator tasdiqlaydi. Loglardan PII/secretlarni ticketlarga ko‘chirmang. Production
operatorining bajarilgan tekshiruvi sintetik CI natijalaridan alohida yoziladi.
