# 1-bosqich — tekshiruv hisoboti

Sana: 2026-11-09. Yangilangan baza: `origin/main`,
`57899a3adee785b6c7ef2f0780f96c40989e3364` (PR #42 merge’i).
Mahalliy muhit: Node.js 24.19.0, npm 11.9.0; CI Node.js 22 ishlatadi.

| Tekshiruv | Natija |
| --- | --- |
| `npm run typecheck` | API, web, contracts — muvaffaqiyatli |
| `NODE_ENV=production npm run build` | Barcha uch modul — muvaffaqiyatli |
| `npm audit --audit-level=high` | 0 ta zaiflik |
| `npm audit --omit=dev --audit-level=high` | 0 ta zaiflik |
| Avval yiqilgan moliyaviy test | 1 o‘tdi; to‘liq suite’dan oldin bajarildi |
| API testlari | 592 o‘tdi, 1 mavjud recovery skip; 41 fayl; 0 xato |
| Web testlari | 138 o‘tdi, 25 fayl; 0 xato |
| Contracts testlari | 1 o‘tdi; 0 xato |
| Python gateway xavfsizlik testlari | 11 o‘tdi |
| Node audit tayyorgarligi testlari | 6 o‘tdi |
| `actionlint` 1.7.11 | Barcha to‘rtta workflow xatosiz |
| `git diff --check` | Xatosiz |

To‘liq `npm test` exit code `0`: jami 731 test o‘tdi, 1 recovery skip,
moliyaviy testlarda skip yoki xato yo‘q. API suite 193.60 soniyada yakunlandi.

GitHub CI natijalari aynan yangilangan branch commit’i push qilingandan keyin
tekshiriladi; yakuniy run va job havolalari PR #43 tavsifida beriladi. Mahalliy
tekshiruv GitHub CI muvaffaqiyatli yakunlanganini o‘z-o‘zidan isbotlamaydi.

## PR #42 tuzatishi va main bilan birlashtirish

PR #42’ning `45cf8aec748f0b35df402191e77bfdf4244c7dcf` commit’i va
`57899a3adee785b6c7ef2f0780f96c40989e3364` merge commit’i `origin/main`
tarixida borligi `git merge-base --is-ancestor` bilan tasdiqlandi.
Mavjud `automation/phase-1-ci-readonly-audit` branch’iga main merge qilindi;
konflikt bo‘lmadi. Yangi PR yaratilmaydi.

Avvalgi xato: pilot moliyaviy testdagi reversal/void amallari haqiqiy
2026-11-09 sanasini olgan, hisobot esa 2026-11-07 da tugagan. PR #42
`vi.setSystemTime(new Date("2026-11-07T12:00:00+05:00"))` orqali faqat test
vaqtini hisobot davriga mahkamlaydi. Moliyaviy assertion’lar kuchsizlantirilmagan;
test fayli yangilangan main bilan aynan bir xil. Tuzatilgan test alohida
bajarilib, 1/1 o‘tdi. Ushbu yangilashda production backend moliyaviy mantig‘i
o‘zgartirilmadi.

Phase 1 workflow’lari, prompt, gateway, automation xavfsizlik testlari,
contracts tekshiruvlari va lokal MongoDB qo‘riqchisi saqlandi. Workflow fayllari
oldingi PR #43 head’i bilan aynan bir xil; barcha GitHub permissions faqat
o‘qish huquqida qoldi. AI faollashtirilmadi, secret qo‘shilmadi, pullik API
chaqirilmadi. PR #43 merge qilinmaydi va production deploy bajarilmaydi.

## Mavjud intentional recovery skip

`apps/api/tests/recovery.test.ts:52` dagi native encrypted backup/restore
sinovi avvaldan `it.runIf(process.env.DR_DRILL_CONFIRM === 'synthetic-only')`
bilan himoyalangan. Oddiy suite bu shartni yoqmaydi; natijadagi yagona skip
shu maxsus recovery sinovidir. Preflight va arxiv yaxlitligining qolgan recovery
testlari oddiy suite’da bajariladi. Moliyaviy testlarga skip qo‘shilmagan.

## Codex va xavfsizlik dalillari

Rasmiy `@openai/codex@0.167.0` hamda
`@openai/codex-responses-api-proxy@0.167.0` bilan lokal mock sinovi bajarildi:
Avvalgi Phase 1 tekshiruvida CLI → rasmiy proxy → budjet darvozasi → lokal
soxta API oqimi ishlatildi. `:read-only` profili,
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
