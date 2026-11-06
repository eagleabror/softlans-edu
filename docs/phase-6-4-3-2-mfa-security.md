# Phase 6.4.3.2 — MFA va sessiya xavfsizligi

## Tekshirilgan boshlang‘ich arxitektura

Ish boshlashdan oldin `origin/main` yangilandi va `3732647` (Phase 6.4.3.1, PR #32) tekshirildi. Yangi branch: `feat/phase-6-4-3-2-mfa-security`.

- `models.ts`: global unique email, bcrypt parol xeshi, tenantga bog‘langan rollar, `active`, yashirin `sessionVersion`; Super Admin faqat `tenantId=null` bilan ishlaydi.
- `security.ts`: HS256 JWT, qat’iy issuer/audience/algorithm, 1 soat amal qilish; HttpOnly, SameSite=Strict, productionda Secure cookie. Har so‘rovda DBdagi rol, hisob va markaz faolligi, sessionVersion tekshiriladi. Keyin mavjud subscription entitlement bajariladi.
- `app.ts`: email/parol tekshiruvigacha rate limit; register tranzaksiyasi va mavjud trial yaratish saqlangan. API yozuvlariga exact Origin va JSON talabi qo‘llanadi. Javoblar `no-store`; xatolar request body/cookie/URL qiymatlarini loglamaydi.
- `password-security.ts`: 15 daqiqalik SHA-256 reset tokeni, atomar parol almashuvi va `sessionVersion` inkrementi, email gateway faqat sozlangan va tasdiqlanganda. Public recovery Super Admin uchun yopiq.
- `scripts/super-admin.ts`: faqat yangi Super Admin yaratadi; tenant hisobini promote qilmaydi. Markazni bloklash mavjud sessiyalarni global version bilan bekor qiladi.
- Frontend: `App.tsx` login va `/auth/me` bilan holatni tiklaydi; account va Super Admin account sahifalari mavjud `PasswordSecurity` komponentidan foydalanadi. RBAC serverda qoladi.

## TOTP va tiklash

`otpauth` RFC 6238 TOTPni bajaradi: 160 bit CSPRNG secret, SHA-1 interoperabil format, 6 raqam, 30 soniya, faqat −1/0/+1 qadam. Server vaqti ishonch manbai; NTP talab qilinadi. Oxirgi qabul qilingan qadam User ichida saqlanadi. Eski/teng qadam rad etiladi, jumladan boshqa challenge yoki qurilmada. Oldinga drift qabul qilinsa, server vaqti o‘sha qadamdan o‘tmaguncha oldingi kodlar ham rad etiladi.

AES-256-GCM Node/OpenSSL orqali ishlaydi: har shifrlashda tasodifiy 96 bit nonce, 128 bit authentication tag, user ID va format versiyasiga bog‘langan AAD. `MFA_ENCRYPTION_KEY` — JWTdan alohida, server-only 32 bayt kalit (64 hex belgi). Kalit yo‘qligida yangi enrollment yopiq, MFA yoqilgan hisobga password-only fallback yo‘q. `select:false` secret, pending secret, recovery hashes, replay va attempt state oddiy User so‘rovlaridan yashirilgan. Oddiy APIlar explicit view qaytaradi.

Endpointlar (`/api/auth` ostida):

| Endpoint | Himoya va natija |
| --- | --- |
| POST `/security/enroll` | To‘liq sessiya + shu so‘rovda parol; 10 daqiqalik shifrlangan pending secret; faqat provisioning QR data URL qaytadi |
| POST `/security/confirm` | Parol + pending TOTP; tranzaksiyada enable, replay qadamini yozish, eski versionni bekor qilish, yangi MFA sessiyasi va 10 recovery kod |
| POST `/security/cancel` | Parol + to‘liq sessiya; pending secretni olib tashlaydi |
| GET `/security` | Faqat enable/configured holati, qolgan kodlar soni, Super Admin policy |
| POST `/security/recovery-codes` | Parol + TOTP yoki recovery kodi; avvalgi kodlar va pending challengelar bekor qilinadi |
| POST `/security/disable` | Parol + TOTP/recovery; barcha sessiyalar bekor; enforcement yoqilgan Super Admin uchun rad etiladi |

Har recovery kodi 128 bit tasodifiy qiymat; 10 ta kod faqat yaratish javobida ko‘rsatiladi. DBga faqat SHA-256 digest tushadi. Yuqori entropiyali tokenlarga bu xeshlash mos; inson tanlagan parollar avvalgidek bcrypt bilan saqlanadi. Kod `$pull` bilan tranzaksiyada bir martalik sarflanadi. Kodlarni yangilash eski to‘plamni to‘liq almashtiradi. UI kodlarni localStorage/sessionStorage, URL yoki analyticsga yozmaydi. Uzun kod/parol qiymatlari request bodydan tashqariga chiqmaydi.

**Foydalanuvchi yo‘riqnomasi:** kodlarni ishonchli parol menejerida yoki qog‘ozga yozib, qulflanadigan joyda saqlang. Email, chat va umumiy bulutli jildlarga yubormang; skrinshot olmang. Autentifikator qurilmasidan alohida saqlang. Har bir kod faqat bir marta ishlaydi.

## Challenge va parallel so‘rovlar

MFA hisobida email/parol faqat 5 daqiqalik, 256 bit opaque challenge yaratadi. Uning SHA-256 digesti DBda, raw qiymati esa alohida HttpOnly/SameSite=Strict/Secure-production `/api/auth/mfa` cookie ichida turadi. Bu JWT emas; `authenticate` uni CRM, platforma yoki SaaS uchun qabul qilmaydi. Password bosqichi oldingi auth cookieni tozalaydi. Har muvaffaqiyatli kirish yangi random session ID oladi.

`POST /mfa/verify` TOTP yoki recovery kodini tekshiradi; `/mfa/cancel` uni bekor qiladi. Challenge consumption, factor consumption va sessiya yaratish bitta MongoDB tranzaksiyasida. Account version/MFA revision/expiry/current tenant qayta tekshiriladi. Foydalanuvchi va tenant yozuvlari mavjud status/parol almashuvlari bilan write-conflict orqali serializatsiya qilinadi. Saqlash xatosida challenge va recovery consumption rollback qilinadi. Avvalgi challenge qayta yuborilsa yangi sessiya berilmaydi.

Har challenge uchun ko‘pi bilan 5 urinish. Account uchun 5 daqiqada 5 factor/settings urinish DBda atomar cheklanadi; app restart yoki yangi challenge bu budgetni tozalamaydi. Muvaffaqiyatli tekshiruvlar ham budgetga kiradi. Qo‘shimcha IP limitlar: verify/cancel/revoke uchun 30/5 daqiqa, sensitive settings uchun 10/5 daqiqa; mavjud login 15/15 daqiqa. IP limiter process-local, account limiter esa barcha instansiyalar uchun umumiy. Proxy hoplarini faqat haqiqiy trusted proxy soniga sozlash zarur.

Parol o‘zgartirish/tiklash MFAni o‘chirmaydi. `sessionVersion` eski challenge va sessiyalarni rad qiladi; yangi parol bilan kirish yana MFA talab qiladi.

## Qurilmalar registri va migratsiya

`DeviceSession`: 256 bit random `sid`, owner User, sessionVersion, MFA darajasi, expiry, yaratilgan/oxirgi faollik va coarse OS/browser label. Raw JWT, raw UA, IP, geo yoki fingerprint saqlanmaydi. Signed JWT `sid` va `mfa` claimlarini saqlaydi; DBda egasi, version, MFA darajasi, expiry va revocation har so‘rovda tekshiriladi. TTL faqat tozalash uchun; xavfsizlik tekshiruvi TTL ishga tushishini kutmaydi. Oxirgi faollik ko‘pi bilan minutiga yangilanadi, UI vaqtni minut aniqligida ko‘rsatadi.

| Endpoint | Xulq |
| --- | --- |
| GET `/sessions` | Faqat o‘zining hozirgi versiondagi sessiyalari, joriy qurilma belgisi; `sid` yashirilgan |
| POST `/sessions/revoke` `{id}` | Faqat actor egasi bo‘lgan bitta sessiya; keyingi so‘rov darhol rad etiladi |
| POST `/sessions/revoke-others` | Parol va MFA yoqilganida factor; global version oshadi, joriy qurilmaga yangi sessiya beriladi |
| POST `/logout` | Registrli sessiyada faqat joriy qurilma; legacy sessiyada global version bekor qilinadi |

Parol change/reset, tenant block va mavjud boshqa global `sessionVersion` amallari saqlangan. Boshqa sessiyalarni tugatish versiya orqali legacy JWTlar va parallel eski login challengelarni ham bekor qiladi. Allaqachon autentifikatsiyadan o‘tib bajarilayotgan so‘rov ortga qaytarilmaydi; revocation keyingi autentifikatsiya tekshiruvida kuchga kiradi.

Migratsiya:

1. Replica set, yangi kolleksiya va unique/TTL indexlarni stagingda tekshiring. User yangi maydonlari additive; eski akkauntlarda Mongoose defaultlari ishlaydi.
2. Qat’iy rejim sukut bo‘yicha registrsiz tokenni qabul qilmaydi; foydalanuvchi qayta login qiladi. Uzluksiz o‘tish uchun operator deploy boshlanishining aniq UTC vaqtini `SESSION_LEGACY_ISSUED_BEFORE` qilib beradi (kelajak vaqti konfiguratsiyada rad etiladi).
3. Faqat cutoffgacha yaratilgan, avvalgi JWT tekshiruvlaridan o‘tgan tokenlar cutoff+1 soatgacha ishlaydi. Vaqtni har restartda yangilamang. Bu davrda legacy holati UIga aytiladi; sensitive yangi sozlash uchun qayta login shart.
4. Yangi login/register har doim registr yaratadi. MFA yoqilishi eski password-only JWTni migratsiya oynasida ham darhol rad etadi.
5. Bir soatdan so‘ng cutoffni olib tashlang. Registr o‘chirilgan/yo‘q/expired token uchun legacy fallback yo‘q. Rollback vaqtida MFA holatini tushunmaydigan eski binaryga qaytmang: u password-only loginni qayta ochishi mumkin. Shu versiyani saqlab, enforcement bosqichini operator nazorati bilan boshqaring.

## Super Admin xavfsiz faollashtirish va recovery siyosati

`SUPER_ADMIN_MFA_ENFORCED=false` default: mavjud Super Adminlar kirib, o‘zlari parol bilan enrollment boshlaydi. **Bu bosqichda MFA hali global majburiy emas.** Alohida endpoint/email link orqali privileged enrollment bypass yo‘q. MFAni yoqqan Super Admin uchun flagdan qat’i nazar har login challenge talab qiladi.

Operator faollashtirish checklisti (bu ish davomida bajarilmadi):

- [ ] Alohida `MFA_ENCRYPTION_KEY`ni server secret managerda yarating, nusxasini nazoratli backupda saqlang; DB backup bilan tiklashni stagingda sinang. JWT kalitini qayta ishlatmang.
- [ ] Barcha aktiv Super Adminlar odatiy login → Security Settings → QR → haqiqiy authenticator kodi bilan enroll qilsin. Kamida ikkita mustaqil vakolatli operator hisobi tavsiya qilinadi.
- [ ] Har operator QRni yopib, yangi login TOTP va alohida bitta recovery kodi bilan tiklanishni amalda sinasin. Kodlarni yangilab, yangi nusxani xavfsiz saqlasin. Account cooldownni kutish zarur bo‘lishi mumkin.
- [ ] Vakolatli muhitda `npm run mfa:readiness -w @softlans/api`ni ishga tushiring: faqat hisoblar soni va tayyor sonini chiqaradi, secret/identity chiqarmaydi. Exit 0 enrollment holatini bildiradi; haqiqiy device/recovery drill o‘rnini bosmaydi.
- [ ] Barcha aktiv Super Adminlar tayyorligi va recovery drill dalilini operator change recordiga yozing. Yangi Super Admin yaratish ham enforcementdan oldin rejalashtirilsin: enforced rejimda enroll qilinmagan yangi Super Admin login qilolmaydi.
- [ ] Shundan keyingina `SUPER_ADMIN_MFA_ENFORCED=true`ni operator yoqsin va barcha instansiyalarda bir xil konfiguratsiya qo‘llasin. Eski password-only Super Admin sessiyalari rad etiladi; oddiy password-only login ham rad etiladi.
- [ ] CRM/RBAC, bloklangan tenant, TOTP/recovery login va session revoke smoke testlarini qaytaring. Secretli request/response body, QR, code input va cookie uchun proxy/APM/session replay yozuvlarini o‘chiring; enrollment/recovery sahifalarini screen-recordingga qo‘shmang.

Super Admin recovery public emailga tayana olmaydi: mavjud password + oldindan berilgan bir martalik recovery code talab qilinadi. Recovery kodlar ham yo‘qolsa, avtomatik bypass berilmaydi. Avvaldan tasdiqlangan ikkinchi operator va tashkilotning ikki kishilik offline identity/change-control jarayoni orqali incident ochiladi; mavjud tegishli secure backup/credential recovery tartibi qo‘llanadi. Tasdiqlanmagan email xabari asosida secretni o‘chirish yoki enforcementni global o‘chirish taqiqlanadi. Bu PR emergency bypass endpoint yoki yashirin master code qo‘shmaydi.

Kalit yo‘qolsa MFA secretlari tiklanmaydi; backup muhim. Joriy format `v1`; rotation avtomatik emas: eski kalitni saqlagan holda nazoratli maintenance migratsiyasi bilan har User AADga mos decrypt/re-encrypt qilish, tekshirish va keyin yangi konfiguratsiyani barcha instansiyalarga atomar tarqatish talab qilinadi. Eski kalitni shunchaki almashtirmang.

HTTP javob yo‘qolsa: enrollment commitdan keyin kodlarni qayta o‘qib bo‘lmaydi; authenticator bilan yangi login va strong reauth orqali kodlarni yangilash mumkin. Recovery login response yo‘qolsa sarflangan kod qayta ishlamaydi; boshqa kod yoki yangi TOTP ishlatiladi. Bu holatlar maxfiy kodni qayta ko‘rsatadigan API bilan hal qilinmaydi.

## Interfeys, tekshiruvlar va dalillar

`/account/security` barcha autentifikatsiyalangan rollar va Super Admin accountidan ochiladi. Joriy `design-system.css` Figma dizayn tokenlari (`forest`/`lime` aliaslari ham shu tokenlarga bog‘langan), PasswordField, PageHeading, button/panel va native dialog ishlatilgan. O‘zbekcha matnlar, ko‘rinadigan label, one-time-code autocomplete, loading/busy/error/retry, qayta tasdiqlash formalariga focus, dialog Escape/focus restore mavjud. QR/recovery faqat komponent xotirasida, QR 10 daqiqada yashiriladi. Reload pending QR yoki recovery kodlarni tiklamaydi.

Sinovlar: RFC vektori va drift chegaralari; wrong/expired/replayed TOTP; parol bilan enrollment/confirm/cancel/expiry; parallel confirm; challenge isolation/expiry/reuse/cancel/version; recovery single-use va parallel consumption; regeneration; storage failure rollback; Super Admin staged rollout va real enrollment; public resetdan keyin MFA; current/other/legacy/expired/cross-account sessiyalar; tenant/role/disabled user/block; CSRF/JSON/query/strict input; account/IP cooldown; secret/log himoyasi. Eski test fixturelari JWTni qo‘lda berish o‘rniga haqiqiy registr yozuvini yaratishga moslangan.

Playwright skripti: `scripts/mfa-security-capture.mts`. Faqat yangi disposable lokal MongoDB va sintetik hisoblar bilan haqiqiy API+UI ishlatadi. QR-kod, recovery ro‘yxati, kod input va parol input screenshot vaqtida niqoblanadi. Skript rasmiy Google/Microsoft mobil ilovasini avtomatlashtirmaydi; RFC mosligi va server/browser oqimi tekshiriladi. Rasmiy ilovalardagi haqiqiy operator drill yuqoridagi activation checklistida qoladi.

[Skrinshot indeksi](../artifacts/mfa-security/README.md) · [Mashina manifesti](../artifacts/mfa-security/manifest.json)

Yakuniy command natijalari quyida keltirilgan. Production DB, secretlar, deploy va merge bajarilmagan. SaaS billing/trial va tenant/RBAC qoidalari o‘zgartirilmagan. Production faollashtirish checklisti bajarilmaguncha tizimni productionda tasdiqlangan deb hisoblamang.

### Yakuniy tekshiruv natijalari

| Buyruq | Haqiqiy natija |
| --- | --- |
| `npm test` | PASS: API 461 passed / 1 skipped; web 116 passed. Jami 577 passed / 1 skipped |
| `npm run typecheck` | PASS, ikkala workspace |
| `npm run build` | PASS; Vite >500 kB chunk ogohlantirishi mavjud (asosiy JS ~940 kB, gzip ~268 kB) |
| `npm audit --audit-level=high` | PASS: 0 vulnerabilities |
| `npm audit --omit=dev --audit-level=high` | PASS: 0 vulnerabilities |
| `git diff --check` | PASS |
| Playwright capture | PASS: 22 ta niqoblangan screenshot; enrollment, recovery login, individual revoke, dialog focus restore va 8 kenglikda reflow |
| Frontend so‘nggi sana/style o‘zgarishidan keyin | 116 passed; typecheck/build qayta o‘tdi |

Bitta skip — avvalgi phase native encrypted backup/restore drilli; u `DR_DRILL_CONFIRM=synthetic-only` bilan alohida opt-in talab qiladi. MFA testlarining hech biri skip qilinmagan. Dastlabki sandbox urinishida lokal `listen` cheklovi sabab DB sinovlari boshlanmagan; ruxsat etilgan lokal portlar bilan to‘liq qayta bajarilib yuqoridagi natijalar olindi. Dastlabki fixture/UI test xatolari tuzatildi; yakuniy to‘liq test run muvaffaqiyatli.

Yangi ekranlardagi token ranglari hisoblandi: asosiy matn/oq 13.86:1, yordamchi matn va input chegarasi/oq 5.18:1, brand/oq 6.84:1, brand/accent 6.05:1. Bu butun eski ilova uchun mustaqil accessibility auditi emas. Browserda native dialogning focus qaytarishi va yangi formaga focus berilishi tekshirildi.
