# O‘quvchi kabineti

O‘quvchi o‘z dars jadvali, davomati va to‘lovlarini ko‘radi. Kabinet amaldagi CRM ma’lumotlarini faqat o‘qiydi; uy vazifalari, baholar, SMS login va onlayn to‘lov bu talqinga kirmaydi.

## Hisob ochish va foydalanish

1. Markaz egasi yoki administrator **O‘quvchilar → Profil → O‘quvchi kabineti → Kabinet ochish** bo‘limini ochadi.
2. Global takrorsiz email va boshlang‘ich parol kiritiladi. Parol kamida 12 ta belgi, ko‘pi bilan 72 UTF-8 bayt bo‘lishi kerak. Kirish ma’lumotlari o‘quvchiga alohida yetkaziladi; parol javoblarda yoki loglarda qaytarilmaydi.
3. O‘quvchi mavjud kirish sahifasida email/parol bilan kiradi va `/student` sahifasiga yo‘naltiriladi.
4. Kabinetda **Asosiy**, **Dars jadvali**, **Davomatim**, **To‘lovlarim** va **Profilim** bo‘limlari mavjud. Profil orqali mavjud parol va MFA/sessiya boshqaruvi ochiladi.

Bitta o‘quvchi profiliga faqat bitta hisob bog‘lanadi. Mavjud xodim hisobini avtomatik bog‘lash yoki email bo‘yicha taxminiy moslashtirish yo‘q. Xodimlar ro‘yxati va xodim statistikasi o‘quvchi hisoblarini sanamaydi.

## API va ma’lumot chegaralari

| Endpoint                                           | Ruxsat / natija                                                                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/students/:id/account`                    | Owner/Admin; o‘z markazidagi profilga bog‘langan hisob holati                                                                   |
| `POST /api/students/:id/account`                   | Owner/Admin; qat’iy `{email, password}` bilan hisob ochish                                                                      |
| `GET /api/student/profile`                         | O‘quvchining ismi, emaili, telefoni, markazi, holati va qabul sanasi                                                            |
| `GET /api/student/dashboard`                       | Faol guruhlar, joriy oy davomati, barcha davrlardagi qolgan summa, eng yaqin to‘lov muddati va keyingi yetti kundagi yaqin dars |
| `GET /api/student/schedule?date=YYYY-MM-DD`        | Berilgan sanaga tegishli hafta; standart Toshkentdagi bugun                                                                     |
| `GET /api/student/attendance?month=YYYY-MM&page=1` | Oylik davomat va sahifalangan darslar tarixi                                                                                    |
| `GET /api/student/charges?month=YYYY-MM&page=1`    | Tanlangan oy hisoblari va shu hisoblar bo‘yicha summalar                                                                        |
| `GET /api/student/payments?month=YYYY-MM&page=1`   | To‘lov amalga oshirilgan oy bo‘yicha tarix, jumladan bekor qilingan to‘lovlar                                                   |

Tarix uchun sahifa hajmi 20, standart oy Toshkentdagi joriy oy. Hisoblar va to‘lovlar tarixi alohida sahifalanadi. `tenantId` va `studentId` faqat serverdagi hisobdan olinadi; shaxsiy endpointlar qo‘shimcha query maydonlarini rad etadi. CRM izohlari, xodim identifikatorlari, boshqa o‘quvchilar ro‘yxati va umumiy markaz moliyasi uzatilmaydi. O‘quvchi mavjud CRM boshqaruv API’lariga kira olmaydi.

Jadval a’zolikning boshlanish/tugash vaqtini hisobga oladi. Saqlangan darsning vaqti, ro‘yxati va bekor qilinishi qayta hisoblangan jadvaldan ustun turadi. Kabinetni ochish yangi `LessonSession` yaratmaydi. Mavjud dars snapshotida xona saqlanmaganligi sababli xona nomi amaldagi jadvaldan olinadi; tarixiy xona alohida tiklanmaydi.

Davomat foizi mavjud `attendanceTotals` qoidasidan olinadi: `(kelgan + kechikkan) / belgilangan`. Bekor qilingan va boshlanish vaqti hali kelmagan darslar hisobga olinmaydi. Belgilanmagan davomat kelmagan deb belgilanmaydi; ma’lumot bo‘lmasa foiz `—` ko‘rsatiladi. Moliya mavjud `Charge.finalAmount` va reversallarni hisobga oluvchi `paidAmount` keshiga tayanadi; bekor qilingan hisob qarzdorlikka kirmaydi.

## Hisob holati va chiqarish

`User.role` ga `student`, `User` ga ixtiyoriy, o‘zgarmas `studentId` qo‘shiladi. Bu maydon faqat student hisobida bo‘lishi shart. Mavjud xodim yozuvlariga backfill talab qilinmaydi. Standart `ensureIndexes()` `(tenantId, studentId)` uchun faqat `role: student` yozuvlariga qo‘llanadigan unique indeks yaratadi. Mavjud indekslar olib tashlanmaydi.

Arxivlangan, o‘chirilgan yoki boshqa markazga mos kelmaydigan profilga kirish login, MFA yakunlash va har bir autentifikatsiyalangan so‘rovda rad etiladi. Arxivlash bog‘langan hisobning `sessionVersion` qiymatini tranzaksiyada oshiradi; qayta faollashtirish eski sessiyani tiklamaydi. Tanaffusdagi o‘quvchi tarixini ko‘ra oladi; yangi jadval prognozi yaratilmaydi. Markazning mavjud faol/bloklangan va obuna siyosati saqlanadi; obunasi tugagan markazda o‘qish imkoniyati ochiq qoladi.

## Tekshiruvlar

```sh
npm run typecheck
npm run test -w @softlans/contracts
npm run test -w @softlans/web
npm run test -w @softlans/api -- tests/student-portal.test.ts tests/students.test.ts tests/unit.test.ts tests/integration.test.ts tests/mfa-security.test.ts tests/password-security.test.ts
npm run build
git diff --check
```

Brauzerda: admin hisob ochishi → logout → o‘quvchi login → barcha besh bo‘lim; telefonda menyuni ochish, Escape bilan yopish, fokusning ochish tugmasiga qaytishi, navigatsiyadan keyin menyuning yopilishi; 320–1440px da uzun ism/summalar va jadvallarning lokal scroll holati tekshiriladi. MongoDB testlari faqat o‘zining vaqtinchalik lokal replica set bazasidan foydalanadi.
