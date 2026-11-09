# SoftLans DevOps AI Agent — 1-bosqich

## Maqsad va birinchi PR chegarasi

Boshlang‘ich nuqta: `main`, `872fd4e0930dfdf573ae20b2cc9a0d35836541a0`.
Avval ushbu arxitektura va xavfsizlik modeli yoziladi, keyin CI va faqat o‘qish
huquqidagi audit joriy etiladi. Birinchi PR issue yaratmaydi, dastur kodini AI
bilan o‘zgartirmaydi, Telegram’ga xabar yubormaydi, merge yoki deploy qilmaydi.

## Ishonch chegaralari

| Qism | Kirish | Huquq va natija |
| --- | --- | --- |
| CI | Har bir PR va `main` push | `contents: read`; barcha workspace typecheck, test, production build va ikkita dependency audit |
| AI tayyorgarligi | Ixtiyoriy PR review, kunlik yoki qo‘lda audit | Faqat ishonchli `main` workflow va skriptlar; chegaralangan statik dalillar |
| Codex | Tayyorlangan matn | Rasmiy `openai/codex-action`, `:read-only`, `drop-sudo`; yozish tokeni yo‘q |
| API budjet darvozasi | Faqat bitta Responses so‘rovi | Qat’iy model, token, dollar va vaqt limiti; tool, tashqi URL va qo‘shimcha API yo‘q |
| Keyingi PR: issue nashri | Tekshirilgan audit natijasi | Alohida runner va `issues: write`; AI yoki repository kodini bajarmaydi |
| Keyingi PR: implementatsiya | Inson tasdiqlagan issue | Alohida izolyatsiyalangan ishchi, test va draft PR nashri |
| Keyingi PR: Telegram | GitHub run metama’lumotlari | Alohida ishonchli workflow; faqat bot/chat secret’lari, AI va PR kodi yo‘q |

PR review `pull_request_target` orqali faqat bazadagi workflow’dan bajariladi.
Fork PR’lari va bot hodisalari AI’dan chiqariladi; ularning oddiy CI’i ishlaydi.
PR head checkout qilinmaydi, uning dependency’lari yoki skriptlari bajarilmaydi.
PR diff’i GitHub API’dan ma’lumot sifatida olinadi; title, body va branch nomi
shell kodiga interpolatsiya qilinmaydi. Tekshiruv faqat `main`ga ochilgan PR uchun.
Hodisa muallifi hamda qayta ishga tushiruvchi shaxs repository’da `write`,
`maintain` yoki `admin` huquqiga ega bo‘lishi tekshiriladi.

Repository matni, diff, TODO va izohlar ishonchsiz ma’lumot hisoblanadi. Prompt
ulardagi ko‘rsatmalarga amal qilishni taqiqlaydi. Bunga qo‘shimcha ravishda API
darvozasi barcha tool’larni o‘chiradi: model shell, tarmoq, MCP, database yoki
GitHub API chaqira olmaydi. GitHub va OpenAI secret’lari promptga kiritilmaydi.
Checkout credential’lari saqlanmaydi. AI faqat ajratilgan tayyorgarlik katalogida
ishlaydi; production MongoDB URI, deploy credential yoki Telegram tokeni berilmaydi.
Hisobot Actions natijasida qoladi; PR comment yoki issue sifatida avtomatik
nashr etilmaydi. Model xulosasi inson tekshirishi kerak bo‘lgan maslahatdir.

## CI va test izolyatsiyasi

`verify` check nomi saqlanadi. API, web va contracts alohida typecheck/build
qilinadi; mavjud API/web testlari to‘liq ishlaydi. Contracts eksportlarining
runtime invarianti alohida test qilinadi. Dependency audit barcha paketlar va
production paketlari uchun alohida job’larda ishlaydi; asosiy test xatosi auditni
bekor qilmaydi. `high` va `critical` topilma CI’ni muvaffaqiyatsiz qiladi.

CI’da production secret yo‘q. `NODE_ENV=test`, `TEST_MONGODB_URI` va
`MONGODB_URI` bo‘sh beriladi; mavjud `mongodb-memory-server` testlari vaqtinchalik
lokal replica set yaratadi. Tashqi test bazasiga fallback qilinmaydi. Test
jarayonidagi ulanish qo‘riqchisi faqat loopback MongoDB manzillarini qabul qiladi.
Bu himoya dastur production ulanish funksiyasini o‘zgartirmaydi.

## AI’ni yoqish va xarajat siyosati

Oddiy CI uchun hech qanday yangi secret yoki variable kerak emas. AI standart
holatda o‘chiq; kalit yo‘qligi CI’ni buzmaydi. Maintainer quyidagilarni sozlaydi:

- Actions variable `AI_READONLY_ENABLED=true`.
- Actions secret `OPENAI_API_KEY`: faqat alohida OpenAI project kaliti.
- Actions variable `AI_PRICING_REVIEWED_ON=2026-11-09`: quyidagi tarif chegaralari
  va model mavjudligi tekshirilganini bildiradi. Siyosat 30 kundan keyin yopiladi;
  muddat/tarif yangilanishi alohida review qilingan PR talab qiladi.

Rasmiy manbalar: [Codex Action](https://github.com/openai/codex-action),
[xavfsizlik](https://github.com/openai/codex-action/blob/main/docs/security.md),
[model](https://developers.openai.com/api/docs/models/gpt-6-luna),
[tariflar](https://developers.openai.com/api/docs/pricing).

2026-11-09 holatidagi `gpt-6-luna`: 1 050 000 token kontekst; standart tarif
1M input uchun $0.10 va output uchun $0.50. Uzun kontekst/yozish ustamalarini ham
qoplash uchun darvoza bundan yuqori **$0.50 input / $2.00 output** narxini zaxira
qiladi. Har so‘rov uchun butun model konteksti input deb hisoblanadi; taxminiy
matn/token nisbati yoki modelning o‘z bahosiga ishonilmaydi.

- Bitta run’da ko‘pi bilan **1 ta** upstream so‘rovi, **8192 output token**.
- Eng yomon zaxira: `(1 050 000 × $0.50 + 8192 × $2.00) / 1 000 000 = $0.541384`.
- **$0.60/run** chegarasidan oshadigan so‘rov API’ga yuborilmaydi.
- `service_tier=default`, `store=false`; barcha tool’lar o‘chiriladi.
- Keyingi so‘rov va CLI retry’lari upstream’ga o‘tkazilmaydi. Upstream xatosida
  zaxira qaytarilmaydi; yashirin pullik retry yo‘q.
- AI job timeout 8 daqiqa, Codex step 4 daqiqa, upstream timeout 90 soniya;
  darvoza umri 300 soniya. `run_attempt != 1` bo‘lsa AI ishlamaydi.
- Kunlik audit bir marta; PR concurrency eski run’ni bekor qiladi. Yangi PR
  hodisasi yangi limitli run hisoblanadi; repository bo‘yicha jami oylik xarajat
  uchun OpenAI project’da alohida usage/rate nazorati ham sozlanadi.

Dollar chegarasi hujjatlashtirilgan model tarifi shu yuqori chegaralardan
oshmasligi shartiga bog‘liq; mahalliy dastur provayder tarifini muzlata olmaydi.
Shuning uchun tarif tasdig‘i va 30 kunlik yopilish majburiy. Budget hisobi
faqat rezerv summasini beradi; haqiqiy billing hisobi OpenAI project’da ko‘riladi.
Cheksiz self-prompt, issue → issue yoki bot → bot zanjiri yo‘q.

## Keyingi kichik PR’lar

### PR 2 — auditdan GitHub Issues

Kunlik/qo‘lda audit to‘rtta tur beradi: tugallanmagan vazifalar, test muammolari,
xavfsizlik ogohlantirishlari va texnik qarzdorlik. CI natijasi GitHub Checks’dan,
dependency ogohlantirishlari deterministik auditdan olinadi; AI taxmini test
natijasi deb e’lon qilinmaydi. Alohida `issues: write` job JSON schema, uzunlik,
toifa va fayl yo‘lini tekshiradi, barqaror fingerprint orqali takroriy issue’ni
yangilaydi. Kuniga ko‘pi bilan to‘rtta issue, API timeout va 1 retry. Audit hech
qachon `ai-approved` label qo‘ymaydi; xom log/secret yoki AI buyruqlari nashr qilinmaydi.

### PR 3 — ma’qullangan issue’dan draft PR

Faqat ochiq issue, `ai-approved` label, maintainerning aniq tasdig‘i va himoyalangan
`ai-implementation` environment approvalidan keyin ishlaydi. Label’ni qo‘ygan va
ishga tushirgan shaxsning huquqi tekshiriladi. Issue matni/revision hash’i approval
paytida saqlanadi; issue tahrirlansa yoki label olib tashlansa ruxsat bekor bo‘ladi.

Agent talablarni o‘qiydi va o‘zbekcha texnik reja tuzadi; eng so‘nggi `main`dan
`ai/issue-N-run-ID` branch nusxasida kod yozadi. Test worker’da production secret,
yozish tokeni va production DB tarmog‘i yo‘q. Barcha testlar lokal sintetik bazada.
Natija patch va test hisobotidir. Alohida nashr job’i patch yo‘llari, hajmi,
taqiqlangan workflow/credential fayllari, issue holati, approval hash’i va base
SHA’ni qayta tekshiradi; shundan keyin eng kam huquqli GitHub App tokeni bilan
branch va draft PR yaratadi. Nashr job’i patch kodini bajarmaydi.

PR tavsifida talablar, reja, o‘zgarishlar, bajarilgan testlar, xatolar, cheklovlar
va xarajat bo‘ladi. Bitta issue/revision uchun bitta urinish, bitta draft PR;
avtomatik qayta prompt yoki failed-test repair sikli yo‘q. Yangi urinish yangi
inson approvalini talab qiladi. Merge va deploy huquqi berilmaydi.

Authentication, tenant isolation, billing va database migration o‘zgarishlariga
majburiy inson review’i kerak. Owner branch ruleset’da required approving review,
dismiss stale approvals va oxirgi push’ni boshqa shaxs tasdiqlashini yoqadi;
CODEOWNERS va require-code-owner-review bilan tegishli yo‘llarni himoyalaydi.
AI o‘z review’ini approval o‘rnida ishlata olmaydi. Bu repository sozlamalari ushbu
PR orqali o‘zgartirilmaydi; implementatsiya bosqichini yoqishdan oldin tekshiriladi.

### PR 4 — xavfsiz Telegram bildirishnomalari

Alohida `workflow_run: completed` workflow ishonchli default branch’dan ishlaydi;
PR checkout qilmaydi, artifact, AI matni yoki xom log yuklamaydi. Allowlist’dagi
workflow ID, repository, event, branch va conclusion tekshiriladi. Faqat qat’iy
o‘zbekcha status, run ID va GitHub run havolasi yuboriladi. `TELEGRAM_BOT_TOKEN`
va `TELEGRAM_CHAT_ID` faqat notification job’ida; dastur botidan alohida bot.
Token URL/log/exception’da chop etilmaydi, Markdown parsing o‘chiq, HTTP timeout
10 soniya, ko‘pi bilan 1 retry, job timeout 2 daqiqa, `run_id` dedup kaliti.
Bu tashqi xabar yuborish mexanizmi keyingi alohida PR’da ko‘rib chiqiladi.

## Qabul mezonlari

CI barcha PR’larda secretsiz ishlaydi. AI yoqilmagan, kalit yo‘q, fork/bot,
huquqsiz actor, eskirgan tarif tasdig‘i yoki qayta run — AI o‘tkazib yuboriladi.
Read-only audit o‘zbekcha dalilli natija beradi; o‘zgartirish, issue, PR, merge,
deploy yoki Telegram jo‘natish huquqi yo‘q. Budjet, prompt injection, timeout,
redaction va lokal DB qo‘riqchisi uchun maqsadli xavfsizlik testlari CI’da ishlaydi.
