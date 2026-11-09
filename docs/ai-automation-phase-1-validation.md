# 1-bosqich — tekshiruv hisoboti

Sana: 2026-11-09. Baza: `main`, `872fd4e`.
Mahalliy muhit: Node.js 24.19.0, npm 11.9.0; CI Node.js 22 ishlatadi.

| Tekshiruv | Natija |
| --- | --- |
| `npm run typecheck` | API, web, contracts — muvaffaqiyatli |
| `NODE_ENV=production npm run build` | Barcha uch modul — muvaffaqiyatli |
| `npm audit --audit-level=high` | 0 ta zaiflik |
| `npm audit --omit=dev --audit-level=high` | 0 ta zaiflik |
| API testlari | 590 o‘tdi, 1 o‘tkazib yuborildi, 1 mavjud xato |
| Web testlari | 136 o‘tdi, 25 fayl |
| Contracts testlari | 1 o‘tdi |
| Python gateway xavfsizlik testlari | 11 o‘tdi |
| Node audit tayyorgarligi testlari | 6 o‘tdi |
| `actionlint` 1.7.11 | Ikkala o‘zgartirilgan/yangi workflow xatosiz |
| `git diff --check` | Xatosiz |

API testlari yakuniy konfiguratsiya bilan to‘liq qayta bajarildi: 40 test fayli,
592 test, 193.12 soniya. DB qo‘riqchisi qo‘shilishidan kelib chiqqan URI va bo‘sh
environment moslik xatolari tuzatildi; integration, analytics va izolyatsiya
testlarining alohida 38 ta tekshiruvi ham muvaffaqiyatli.

## Main’da avvaldan mavjud xato

`apps/api/tests/pilot-financial-lifecycle.test.ts:130` xatosi ushbu PR’dan
mustaqil: ayni test o‘zgarishsiz `origin/main`ning alohida worktree’sida, lokal
vaqtinchalik MongoDB bilan qayta bajarilib, bir xil natija berdi.

Test hisobot oralig‘ini `2026-11-07`gacha belgilaydi, lekin reversal/void
operatsiyalari haqiqiy joriy `2026-11-09` sanasini oladi. Shuning uchun test
`receipts=61538, salaryPaid=0, operatingExpenses=0` kutgan joyda
`receipts=161538, salaryPaid=30000, operatingExpenses=20000` qaytdi.
Bu test yashirilmadi, skip qilinmadi va CI muvaffaqiyatli deb ko‘rsatilmadi.
PR draft holatda inson review’iga beriladi. Keyingi alohida test barqarorligi
PR’ida sintetik vaqtni boshqarish tekshirilishi kerak; billing mantig‘ini
o‘zgartirish majburiy inson review’ini talab qiladi.

## Codex va xavfsizlik dalillari

Rasmiy `@openai/codex@0.167.0` hamda
`@openai/codex-responses-api-proxy@0.167.0` bilan lokal mock sinovi bajarildi:
CLI → rasmiy proxy → budjet darvozasi → lokal soxta API. `:read-only` profili,
soxta kalit va o‘zbekcha javob bilan CLI exit code `0`, aniq 1 ta upstream
chaqiruvi; tool’lar bo‘sh, output limiti 8192 token ekanligi tasdiqlandi.
Rasmiy CLI’dagi `additional_tools` input formati ham topilib, darvozada
olib tashlandi. Real OpenAI API chaqirilmadi va API xarajati qilinmadi.

Budjet testlari parallel so‘rov, narx rezervi, limitdan oshish, yashirin tool,
qimmat service tier, model almashtirish, redirect, katta so‘rov, upstream xatosi,
pullik retry va tarif muddati tugashini tekshiradi. Tarif muddati tugagach ham
oddiy CI testlari ishlashi uchun test vaqti deterministik boshqariladi.
Ruxsat testlari fork, bot, huquqsiz actor, qayta run, boshqa branch,
tarif tasdig‘i yo‘qligi, secret redaction va shell injection’ni qamrab oladi.

Mahalliy sandbox socket ochishni taqiqlagani uchun MongoDB/HTTP testlari
tasdiqlangan sandbox tashqarisidagi jarayonda bajarildi. Faqat vaqtinchalik
lokal bazalar ishlatildi; production MongoDB va boshqa production xizmatlariga
ulanilmadi. Secrets sozlanmadi; pullik AI, GitHub’dagi real Codex run va Telegram
yetkazish ushbu muhitda tekshirilgani da’vo qilinmaydi.

Build’da mavjud katta frontend bundle va aralash static/dynamic import haqida
ogohlantirishlar bor; ular build’ni to‘xtatmadi va bu PR’da o‘zgartirilmadi.

## Faollashtirish chegarasi

Workflow default branch’ga inson tomonidan qabul qilingandan keyin kunlik va
qo‘lda audit ishlashi mumkin. AI’ni yoqish uchun
[arxitektura hujjatidagi](ai-automation-phase-1.md) uchta secret/variable sozlamasi
kerak. API kalitisiz CI mustaqil ishlaydi. Issue nashri, `ai-approved` issue’dan
kod yozish va Telegram uchun uchta keyingi PR taklifi o‘sha hujjatda berilgan.
Auto-merge va deploy yoqilmadi.
