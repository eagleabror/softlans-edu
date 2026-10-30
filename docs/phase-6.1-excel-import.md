# 6.1 — Excel va CSV orqali o‘quvchilar importi

## Foydalanish

1. Markaz rahbari yoki administrator sifatida kiring. **O‘quvchilar → Excel import** sahifasini oching.
2. **Excel namuna faylini yuklab olish** tugmasidan foydalaning. Ism va familiya majburiy; telefon ixtiyoriy, 7–15 raqam. Sanalar `YYYY-MM-DD`, `DD.MM.YYYY` yoki `DD/MM/YYYY`; Excel sana kataklari ham qo‘llanadi. Bo‘sh qabul sanasi import kuniga teng.
3. `.xlsx` yoki UTF-8 `.csv` faylni tanlang va tekshiring. Birinchi varaq odatiy tanlov; boshqa varaqni tanlasangiz, **Faylni tekshirish** tugmasini qayta bosing. Faqat tanlangan bitta varaq o‘qiladi.
4. Ustunlarni tekshiring va kerak bo‘lsa qo‘lda moslashtiring. **Moslashtirish va previewni yangilash** tugmasini bosing. Bitta ustunni ikki maydonga moslashtirish mumkin emas.
5. Preview barcha qatorlar, qator raqamlari, yaroqli/xatoli va ehtimoliy dublikatlar sonini ko‘rsatadi. Xatoli qatorlar import qilinmaydi.
6. Dublikat uchun odatiy tanlov — **O‘tkazib yuborish**. Yangi o‘quvchi sifatida qo‘shish alohida rozilik talab qiladi. Mavjud o‘quvchi almashtirilmaydi.
7. Previewni tekshirganingizni tasdiqlang va importni boshlang. Natijadagi qo‘shilgan, o‘tkazilgan va xatoli sonlarni tekshiring. Tarix markaz doirasida saqlanadi.

Qisman bajarilganda oldingi muvaffaqiyatli batch yozuvlari saqlanadi. Xato sababini tuzatib, qolgan qatorlarni yangi faylda yuboring; telefonli dublikatlarni o‘tkazish tanlovini saqlang. Telefonsiz o‘quvchilarni avtomatik bir xil deb hisoblamaymiz: qayta yuboriladigan qatorlarni ayniqsa diqqat bilan tekshiring.

## API

Barcha yo‘llar `/api/student-imports` bilan boshlanadi. JWT cookie, aniq Origin va JSON talabi mavjud himoyadan olinadi. Tenant clientdan olinmaydi.

| Usul | Yo‘l | Vazifa |
| --- | --- | --- |
| POST | `/preview` | `{filename,data,sheet?}`; `data` — base64, `sheet` — noldan boshlanadigan varaq indeksi |
| POST | `/:id/mapping` | `{mapping,revision}`; server preview va yangi revision qaytaradi |
| POST | `/:id/commit` | `{revision,idempotencyKey,duplicates,confirmDuplicates?}`; UUID key, `skip` yoki `add` |
| GET | `/:id` | Haqiqiy hisoblagichlar va xavfsiz holat |
| GET | `/?page=1` | 20 tadan markaz import tarixi |
| GET | `/template` | XLSX namuna |

Commit javobi `import` obyektida aniq `status`, `totalRows`, `importedRows`, `skippedRows`, `failedRows` va xavfsiz `errorSummary` qaytaradi. Bir sessiyada ayni key va qaror bilan qayta yuborish yangi Student yaratmaydi. Boshqa key/qaror yoki eskirgan preview rad etiladi. Boshqa sessiyada ayni faylni yuborish alohida import sanaladi; buni dublikat tekshiruvi boshqaradi.

## Xavfsizlik va ishlash chegaralari

- Fayl: 5 MiB; ma’lumot: 2 000 qator + bitta sarlavha; 32 ustun; har katak 2 000 belgi. CSV qatorda 32 KiB; birinchi qator sarlavha hisoblanadi. Bo‘sh Excel qatorlari validatsiyada xato bo‘lishi mumkin.
- CSV: UTF-8 (BOM mumkin), vergul yoki nuqtali vergul. Eski `.xls`, `.xlsm`, parolli Excel va rich text/hyperlink/error kabi murakkab katak obyektlari qabul qilinmaydi.
- ZIP: 300 element, jami e’lon qilingan yoyilgan hajm 20 MiB; makros, tashqi link, embedding, ActiveX va shifrlangan elementlar rad etiladi. Formulalar hisoblanmaydi; tanlangan varaqdagi formula kataklari rad etiladi. Matndagi formula prefikslari validatsiyadan o‘tmaydi; `+` bilan boshlangan haqiqiy telefon bundan mustasno.
- Parser alohida jarayonda: 128 MiB V8 heap, 8 soniya timeout; bir API jarayonida ko‘pi bilan 2 parser. Bu operatsion tizim RSS chegarasi emas. Preview JSON hajmi 8 MiB bilan cheklanadi.
- Preview original faylni diskka yozmaydi. Qatorlar 15 daqiqalik server sessiyasida saqlanadi; MongoDB TTL tozalaydi. Muddati tugagan sessiya TTL fizik o‘chirishidan oldin ham ishlatilmaydi. Commit yakunida qatorlar darhol o‘chiriladi.
- Bir tenantda bir vaqtda bitta running import: MongoDB unique partial index. 50 qatorlik tranzaksiyalar; 45 soniyalik ish muddati va 5 soniyalik commit chegarasi. Har batch’da ruxsat, tenant faolligi va ma’lumot qayta tekshiriladi. Oddiy Student yaratish/tahrirlash bilan bir xil tenant lock dublikat tekshiruvini ketma-ketlashtiradi.
- Uzilishda oxirgi atomik batch hisoblagichlari saqlanadi. Keyingi holat/tarix/import so‘rovi muddati o‘tgan running holatini partial/failed qiladi. Bu doimiy background worker emas; uzilgan import avtomatik davom ettirilmaydi.
- Dublikat mezoni: bo‘sh bo‘lmagan normallashtirilgan telefon + katta/kichik harfga bog‘liq bo‘lmagan ism/familiya. Fayl ichidagi shunday takrorlar ham aniqlanadi. Telefonsiz qatorlar avtomatik dublikat bo‘lmaydi. Fuzzy ism qidiruvi yo‘q.
- Limitlar: foydalanuvchiga daqiqada 60 import API so‘rovi, shundan 5 ta upload; tenantga 10 ochiq sessiya. Rate limiter mavjud Express uslubida har API instansiyasi xotirasida, running import va idempotency himoyasi esa DB darajasida.
- Student yozuvida `importId`; doimiy auditda tenant, yuklagan foydalanuvchi, xavfsiz fayl nomi, hisoblagichlar va vaqtlar saqlanadi. Xatolarda raw fayl, DB xatosi yoki shaxsiy ma’lumot logga chiqarilmaydi.
- Teacher va Super Admin uchun import API yopiq. Tarixni markaz rahbari va shu markaz administratori ko‘radi; sessiyani faqat uni yuklagan foydalanuvchi tasdiqlaydi.
- Yangi modellar indekslari mavjud `ensureIndexes()` orqali yaratiladi. Mavjud tizim kabi MongoDB replica set talab etiladi. Render/Atlas sozlamalari o‘zgartirilmagan; avtomatik deploy/merge yo‘q.

## Tekshirish buyruqlari

```sh
npm ci
npm run test
npm run typecheck
npm run build
npm audit
git diff --check
```

Yangi backend testlari haqiqiy vaqtinchalik MongoDB replica set va XLSX/CSV fixturelar bilan ishlaydi. UI testlari tanlovlar, tasdiqlar, xato qaytishlari va ayni idempotency key bilan retry’ni tekshiradi. Sinovlar uchun ishlab turgan Atlas bazasi ishlatilmaydi.

ExcelJS ichki `uuid` qaramligi uchun root `overrides` orqali xavfsizlik tuzatmasi (`>=11.1.1`) qo‘llanadi. Lockfile shu versiyani mahkamlaydi; `npm ci` bilan o‘rnatish tavsiya etiladi. Haqiqiy XLSX o‘qish va namuna yaratish testlari ushbu kombinatsiyada bajariladi.

## Yakuniy tekshiruv natijalari

- To‘liq regression: **383 test** — API 324, frontend 59; jami 33 test fayli. Shundan yangi import moduliga 20 backend va 4 UI testi qo‘shildi.
- TypeScript typecheck: API va web muvaffaqiyatli.
- Production build: API va web muvaffaqiyatli.
- Dependency audit: **0 zaiflik**. Dastlab topilgan ExcelJS → uuid muammosi xavfsiz versiya bilan tuzatildi.
- `git diff --check`: xato yo‘q.
- Chromium: 320, 390, 699, 700, 768, 1024, 1440 px da preview tekshirildi. Sahifa darajasida gorizontal overflow yoki JavaScript xatosi topilmadi; varaq o‘zgarganda eski preview bloklanishi tekshirildi. Brauzer tekshiruvi sun’iy API javoblaridan foydalandi; haqiqiy parser va DB operatsiyalari backend integration testlarida tekshirildi. To‘liq WCAG auditi yoki barcha yordamchi texnologiyalar bilan sinov o‘tkazilgani da’vo qilinmaydi.
- Dastlabki tekshiruvlarda aniqlangan mapping’dagi ixtiyoriy ustunlar sxemasi va varaq almashtirishdagi eskirgan preview holati tuzatildi. Dependency qayta o‘rnatilishi paytida uzilgan regression tekshiruvi toza holatda qayta bajarildi va muvaffaqiyatli tugadi.

## O‘zgargan fayllar

| Fayl | O‘zgarish |
| --- | --- |
| `apps/api/src/import-parser.ts` | CSV/XLSX va ZIP xavfsizlik tekshiruvi |
| `apps/api/src/import-worker.ts` | Parser jarayoni |
| `apps/api/src/import-validation.ts` | Mapping, sana, formula va dublikat mezoni |
| `apps/api/src/import-models.ts` | Sessiya, TTL va audit modellari |
| `apps/api/src/student-imports.ts` | Preview, mapping, commit, tarix, holat va namuna API |
| `apps/api/src/app.ts` | Mavjud Origin/auth himoyasi ostida router ulash |
| `apps/api/src/models.ts` | Student importId va yangi indekslar |
| `apps/api/src/students.ts` | Oddiy yaratishni import bilan bir xil tenant lock ostida bajarish |
| `apps/api/tests/student-imports.test.ts` | 20 backend testi |
| `apps/api/package.json` | Parser qaramliklari |
| `apps/web/src/StudentImport.tsx` | O‘zbekcha import wizard va tarix |
| `apps/web/src/StudentImport.test.tsx` | 4 UI testi |
| `apps/web/src/Students.tsx` | Excel import havolasi |
| `apps/web/src/App.tsx` | Ruxsat bilan himoyalangan sahifa yo‘li |
| `apps/web/src/styles.css` | Faqat importga tegishli responsive va accessible uslublar |
| `package.json` | uuid xavfsizlik override’i |
| `package-lock.json` | Qaramliklarning aniq versiyalari |
| `docs/phase-6.1-excel-import.md` | Ushbu foydalanish va texnik hisobot |
