# Phase 6.4.3.1 — parol xavfsizligi

## Amalga oshirilgan imkoniyatlar

Baza: `origin/main`, Phase 6.4.1 auditidagi bcrypt cost 12, JWT/cookie,
`sessionVersion`, exact Origin/JSON himoyasi va rate-limit mexanizmlari saqlandi.
RBAC, tenant a’zoligi, obuna, trial va to‘lov qoidalari o‘zgarmadi. Yangi
kutubxona yoki pullik provayder qo‘shilmadi. Production bazasi, secretlar va
haqiqiy foydalanuvchi parollariga tegilmadi. Merge/deploy bajarilmadi.

- `/account` ichida va `/account/change-password` sahifasida joriy parol bilan
  tasdiqlanadigan o‘zgartirish formasi. Super Admin uchun `/account` mavjud.
- `/forgot-password` va `/reset-password`: o‘zbekcha ko‘rsatmalar, lokal
  validatsiya, yuklanish/bloklangan holat, parolni ko‘rsatish tugmasi, xato va
  tasdiqlangan natija. API muvaffaqiyatidan keyin login sahifasiga qaytiladi.
- Kamida 12 belgi va ko‘pi bilan 72 UTF-8 bayt; bcrypt orqali joriy parolni qayta
  ishlatish rad etiladi. `confirmNewPassword` faqat brauzerda tekshiriladi.

## Endpointlar

Barcha POST so‘rovlari exact `APP_ORIGIN` va `application/json` talab qiladi.
Qo‘shimcha body maydonlari va query parametrlari rad etiladi. Tenant/user/redirect
identifikatorlari qabul qilinmaydi. Javoblar `no-store`; xatolar mavjud
`error.code/message/requestId` formatida.

| Endpoint | Body | Natija / cheklov |
| --- | --- | --- |
| GET `/api/auth/password-recovery` | — | `{enabled:boolean}`; shaxsiy ma’lumot yo‘q |
| POST `/api/auth/change-password` | `currentPassword`, `newPassword` | Auth cookie; 204; 10 urinish / IP / 15 daqiqa |
| POST `/api/auth/forgot-password` | `email` | 202 umumiy javob; 5 urinish / IP / 15 daqiqa |
| POST `/api/auth/reset-password` | `token`, `newPassword` | 204, login qilmaydi; 10 urinish / IP / 15 daqiqa |

Recovery o‘chiq bo‘lsa, so‘rov ham, confirmation ham barcha hisoblar uchun 503
qaytaradi. Noto‘g‘ri DTO 400; Origin 403; JSON bo‘lmasa 415; limit 429.
Yaroqsiz, ishlatilgan yoki eskirgan tokenlar bir xil `INVALID_RESET` 400 oladi.

## Ma’lumot modeli va token hayot sikli

`User` ichidagi yangi, `select:false` maydonlar:

- `passwordResetHash`: 32 tasodifiy baytning 64 belgili hex tokeniga SHA-256.
- `passwordResetExpiresAt`: yaratilganidan 15 daqiqa keyin.
- `passwordResetRequestedAt`: hisob uchun 60 soniyalik admission chegarasi.

Token faqat xotirada, test pochta qutisida yoki provayderga yuboriladigan xabarda
mavjud. DBga tokenning o‘zi yozilmaydi. Qo‘shimcha email/IP nusxalari saqlanmaydi.
Hash uchun sparse index qo‘shilgan. **User kolleksiyasiga TTL index yo‘q**:
eskirish vaqti har confirmation CAS ichida qayta tekshiriladi; hisob o‘chirilmaydi.
Eskirgan hash/timestamp keyingi so‘rovda almashtiriladi yoki muvaffaqiyatli
change/resetda tozalanadi. Bu maydonlar autentifikatsiya javoblariga kirmaydi.

Siyosat: bir hisob uchun bir daqiqada faqat bitta so‘rov atomik qabul qilinadi;
shu oynadagi parallel/takroriy so‘rovlar tokenni almashtirmaydi. Keyingi qabul
qilingan so‘rov avvalgi tokenni **darhol bekor qiladi**. Yuborish xatosida yangi
token tozalanadi; avvalgi token qayta tiklanmaydi. Cleanup faqat aynan o‘sha hashni
o‘chiradi, yangi so‘rov tokeniga tegmaydi. Cooldown yuborish xatosida ham saqlanadi.

Confirmation bitta tranzaksiyada faol tenant bilan yozuv konfliktini
serializatsiya qiladi (`Tenant.passwordSecurityRevision`) va User’ni hash,
expiry, active, rol, tenant, sessionVersion shartlari bilan yangilaydi. Hash
iste’moli, yangi bcrypt hash va sessionVersion oshishi bitta User update’dadir.
Parallel confirmation faqat bir marta muvaffaqiyatli tugaydi. Parallel
change/reset ham eskirgan holatni qayta yozolmaydi. Rol yoki tenant almashtirilmaydi.
Yangi tenant revision maydoni faqat xavfsizlik serializatsiyasi uchun; billing va
subscription revisionlari o‘zgartirilmaydi.

## Sessiyalarni bekor qilish

Change joriy parolni bcrypt bilan tekshiradi va eski hash/sessionVersion bo‘yicha
CAS ishlatadi. Change/reset `sessionVersion`ni oshiradi va joriy cookie’ni mavjud
HttpOnly/Secure/SameSite=Strict/`/api` parametrlari bilan tozalaydi. Nusxalangan
barcha oldingi JWTlar navbatdagi autentifikatsiyada rad etiladi. Yangi sessiya
berilmaydi. Avval autentifikatsiyadan o‘tib bo‘lgan, bajarilayotgan HTTP so‘rovi
orqaga qaytarilmaydi — bu mavjud sessiya arxitekturasining chegarasi.

Faolsiz user yoki tenantga recovery berilmaydi; confirmation va change paytida
holat qayta tekshiriladi. Obunasi tugagan, lekin faol hisob auth operatsiyalarini
mavjud `/auth` istisnosi orqali bajaradi; CRM yozish huquqi kengaytirilmaydi.

## Enumeration va suiiste’molga qarshi himoya

Valid email uchun 202 body hisob bor/yo‘qligi, roli, faolligi, cooldown yoki
provayder natijasiga bog‘liq emas. Javob **hisob qidirilishi va email I/Odan
oldin** yuboriladi, shuning uchun SMTP/provider latency hisobni oshkor qilmaydi.
202 xabar yuborilganini yoki yetkazilganini anglatmaydi.

Har processda ko‘pi bilan 10 ta fon recovery vazifasi bajariladi. Ortiqcha yukda
ham umumiy javob saqlanadi; qabul qilinmagan ish uchun token yaratilmaydi.
Mongo lookup 3 soniya, provider fetch 10 soniya bilan chegaralangan. Hisobning
60 soniyalik cooldown’i MongoDBda bo‘lib, instancelar orasida umumiy. IP va umumiy
API limitlari mavjud process xotirasida; ko‘p instance/restart ta’siri Phase 6.4.1
M3 cheklovi bo‘lib qoladi. Edge/global limitni production topologiyasiga moslang.

## Email adapteri va production faollashtirish

**Ushbu PRda haqiqiy email yetkazilishi tekshirilmagan. Recovery standartda o‘chiq.**
Telegram ishlatilmaydi. O‘z-o‘zidan test adapteriga fallback yo‘q.

`PasswordEmail.sendReset({to,resetUrl})` interfeysi mavjud. Production adapteri
operator tasdiqlagan HTTPS email gateway bilan quyidagi kontrakt orqali ishlaydi:

- `POST PASSWORD_EMAIL_ENDPOINT`, `Authorization: Bearer PASSWORD_EMAIL_API_KEY`;
- JSON `{from,to,subject,text}`; matn o‘zbekcha, bir martalik havola va 15 daqiqalik
  amal qilish muddati ko‘rsatiladi;
- redirect taqiqlangan, 10s timeout, TLS tekshiruvi standart;
- 2xx faqat gateway qabul qilganini bildiradi; non-2xx/network/timeout xato.
  Response body o‘qilmaydi yoki loglanmaydi, stream bekor qilinadi.

Bu tayyor SaaS xizmatiga ulanish da’vosi emas. Tanlangan provayder ushbu kontraktni
qo‘llashi yoki operator tasdiqlagan gateway orqali moslanishi kerak. Hech qanday
provayder xaridi/akkaunti/secret yaratilmagan.

| Konfiguratsiya | Talab |
| --- | --- |
| `PASSWORD_RECOVERY_ENABLED` | Standart `false`; faqat tekshiruvdan keyin `true` |
| `PASSWORD_EMAIL_DELIVERY_VERIFIED` | Standart `false`; real inbox testi uchun operator attestatsiyasi |
| `PASSWORD_EMAIL_ENDPOINT` | Tasdiqlangan HTTPS URL; credential, query va fragment yo‘q |
| `PASSWORD_EMAIL_API_KEY` | Alohida secret, kamida 32 belgi; frontendga berilmaydi |
| `PASSWORD_EMAIL_FROM` | Valid, provayderda tasdiqlangan jo‘natuvchi email |
| `APP_ORIGIN` | Mavjud ishonchli exact origin; productionda HTTPS |

Enabled=true bilan qolgan sozlamalar/tasdiq yetishmasa startup fail-closed.
`DELIVERY_VERIFIED` avtomatik probe emas, uni tekshirmasdan qo‘yish mumkin emas.
`TestPasswordEmail` faqat `tests/helpers`da va `NODE_ENV=test` dependency injection
orqali ishlaydi. Development/productionga test adapterini berish xato chiqaradi.

URL faqat `APP_ORIGIN`dan `/reset-password#token=...` shaklida quriladi; requestdan
Host/redirect/callback olinmaydi. Fragment HTTP access logi/Refererga kirmaydi;
brauzer uni darhol `replaceState` orqali olib tashlaydi va tokenni faqat xotirada
saqlaydi. Reload havolani qayta ochishni talab qiladi. Reset sahifalarida yangi
analytics, storage, HAR/trace yoki uchinchi tomon skripti qo‘shilmagan. Operator
email gatewayda URL click tracking/rewrite, request-body logging va analyticsni
o‘chirsin; token email infratuzilmasi orqali o‘tishi zarur.

Provayder exception/body/email/token/hash/parollar loglanmaydi; faqat
`password_recovery_delivery_failed` yoki cleanup xatosida
`password_recovery_cleanup_failed` allowlist eventlari yoziladi. Barcha recovery
natijalari uchun HTTP javob bir xil qoladi.

## Super Admin uchun operator recovery tartibi

Public email-only recovery Super Admin uchun har doim yopiq, hatto DBda reset
hash mavjud bo‘lsa ham confirmation rad etiladi. Authenticated change joriy parol
bilan ishlaydi. Create-only provisioning skripti o‘zgarmadi; mavjud hisobni
ko‘tarish yoki parolini overwrite qilish uchun ishlatilmaydi.

Parol yo‘qolsa, alohida operator tartibi:

1. Platforma egasining shaxsini oldindan kelishilgan mustaqil kanal orqali
   tekshiring; vakolatli ikki operator/tasdiqlovchi va incident/change yozuvi bo‘lsin.
   Faqat emailga egalik recovery uchun yetarli emas.
2. Vakolatli operator least-privilege, audit qilinadigan maintenance sessiyasini
   ajratsin. Avval disposable/staging hisobida amaliyotni tekshirsin. Secretni
   chat, ticket, terminal argumenti, shell tarixi yoki logga yozmang.
3. Faqat tekshirilgan `_id`, `role=super_admin`, `tenantId=null` va kutilgan
   sessionVersion uchun shartli update rejasi tayyorlansin. Xavfsiz yashirin input
   orqali olingan, policyga mos yangi parol bcrypt cost 12 bilan hash qilinadi;
   hash yangilanishi + sessionVersion increment + reset hash/expiry tozalash
   bitta atomik update bo‘lishi kerak. Mos yozuv soni aynan 1 bo‘lmasa to‘xtating.
4. Yangi credentialni egasiga tasdiqlangan alohida xavfsiz kanal bilan yetkazing;
   login va darhol authenticated password change talab qiling. Eski sessiyalar
   rad etilishini tekshiring. Auditda faqat operator, target ID, vaqt va natija
   saqlansin; password/hash/token saqlanmasin. Vaqtinchalik kirishlarni yoping.

Bu runbook avtomatik self-service bypass bermaydi. Productionda bajarilmadi;
MFA/recovery kodlari keyingi alohida faza doirasida.

## Production checklist

- [ ] Tasdiqlangan provayder/gateway va xarajat/egalik bo‘yicha operator qarori.
- [ ] SPF/DKIM/DMARC, FROM domeni, inbox/spam va bounce tekshiruvi; test rozilikli
  emailda haqiqiy yetkazish dalili. Ushbu PR bu bandni bajarmaydi.
- [ ] Avval recovery o‘chiq holda adapter stagingda tekshirilsin. Missing provider,
  4xx/5xx, timeout, redirect, noto‘g‘ri credential, tarmoq xatosi sinovlari.
- [ ] Origin/HTTPS, gateway TLS, proxy va umumiy edge limitlari tekshirilsin.
- [ ] Gateway/body loglari, click tracking va analyticsda token chiqmasin;
  secret storage/rotation, log retention va operator access nazorati bo‘lsin.
- [ ] Replica set, yangi sparse index va transactionlar stagingda tekshirilsin;
  destruktiv migration yoki index drop talab qilinmaydi.
- [ ] Best-effort fon vazifalari restartda yo‘qolishi mumkinligi qabul qilinsin yoki
  tasdiqlangan durable queue/outbox alohida ishlab chiqilsin. Pending/traffic,
  email failure event va cooldown ta’siri kuzatilsin.
- [ ] Haqiqiy delivery tasdiqlangach `PASSWORD_EMAIL_DELIVERY_VERIFIED=true`,
  barcha provider sozlamalari, so‘ng `PASSWORD_RECOVERY_ENABLED=true` operator
  tomonidan qo‘yilsin. Rollback: recovery flagini o‘chirish; confirmation ham yopiladi.
- [ ] Super Admin operator recovery va incident kontaktlari tasdiqlansin.

## Test natijalari va vizual dalillar

2026-11-06 kuni yakuniy tekshiruvlar:

| Buyruq | Haqiqiy natija |
| --- | --- |
| `npm test` | PASS: API 29 fayl / 436 passed, 1 skipped; web 20 fayl / 110 passed. Jami 546 passed, 1 skipped |
| `npm run typecheck` | PASS |
| `npm run build` | PASS; avvalgi static/dynamic FinancialReports importi va >500 kB Vite chunk ogohlantirishlari saqlangan |
| `npm audit --audit-level=high` | PASS, 0 vulnerabilities |
| `npm audit --omit=dev --audit-level=high` | PASS, 0 vulnerabilities |
| `git diff --check` | PASS |
| Playwright capture | PASS: 22 desktop/mobile skrinshot, haqiqiy lokal API, 0 page error / overflow |

Bitta skipped test — mavjud `recovery.test.ts` ichidagi opt-in native encrypted
backup drill (`DR_DRILL_CONFIRM=synthetic-only` talab qiladi); password testlari
orasida skipped yo‘q. Yangi coverage: 31 API + 9 forma + 1 App navigatsiya testi.
Barcha password integration testlari yangi MongoMemoryReplSet bazasidan foydalanadi;
hech qanday tashqi/production URI qabul qilmaydi.

Coverage: current password to‘g‘ri/noto‘g‘ri, qayta foydalanish, weak/UTF-8 boundary,
expired/forged session, copied-session revocation, tenant/role saqlanishi,
admin/teacher/Super Admin authenticated change, generic enumeration javobi,
expiry/forged/malformed/single-use token, parallel request/consume/change-reset,
keyingi tokenni eski provider xatosi o‘chirmasligi, disabled user/tenant,
Super Admin public deny, Origin/JSON/redirect/query/rate-limit, missing provider,
provider failure va log privacy. UI: fokus, visibility, byte/match validation,
duplicate-submit prevention, retry, expired session va haqiqiy login success holati.

[22 skrinshot galereyasi](../artifacts/password-security/README.md),
[manifest](../artifacts/password-security/manifest.json),
[buyruqlarning yakuniy chiqishi](../artifacts/password-security/verification.txt),
[qayta olish harness’i](../scripts/password-security-capture.mts).
Haqiqiy providerda delivery bu testlar bilan tasdiqlanmaydi.

## Ma’lum chegaralar

- Real provayder/inbox delivery tasdiqlanmagan; production recovery yopiq.
- Fon email ishi durable emas. Restart/tarmoq xatosida yo‘riqnoma kelmasligi
  mumkin; foydalanuvchi cooldown’dan so‘ng qayta so‘raydi. Avtomatik retry yo‘q.
- Gateway qabul qilishi haqiqiy inbox delivery kafolati emas; bounce/webhook yo‘q.
- IP limitlar process-local; NAT va ko‘p instance uchun edge siyosati kerak.
- Email egaligi registrationda tasdiqlanmaydi — bu mavjud arxitektura cheklovi.
- Token fragmenti email tizimida saqlanadi; mailbox xavfsizligi zarur.
- TTL user deletion yo‘q; ishlatilmagan eskirgan hash shu userning keyingi
  password operatsiyasigacha saqlanishi mumkin, ammo undan foydalanib bo‘lmaydi.
- MFA, billing/trial o‘zgarishi yoki yangi public Super Admin recovery bu PRga kirmaydi.
