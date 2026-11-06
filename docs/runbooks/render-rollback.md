# Render xavfsiz release va kodni qaytarish

**Render code rollback MongoDB ma’lumotlarini, indekslarni yoki migrationni
avtomatik tiklamaydi. DB rollback alohida tasdiqlangan recovery jarayonidir.**

Repo dalili: `.github/workflows/ci.yml` PR va main uchun Node 22 bilan npm ci,
typecheck/test/build, to‘liq hamda production dependency audit bajaradi;
contents:read, 15 minut timeout, deploy qadami yo‘q. Branch protection/required
checks tashqi sozlama, tekshirilmagan. `render.yaml`: bitta Node web service,
`npm ci --include=dev && npm run build && npm prune --omit=dev`, `npm start`,
`/api/ready`, auto-deploy off; unda tarixiy phase-1 branch/starter/demo qiymatlari
bor. Bular jonli branch, plan yoki auto-deploy holatini isbotlamaydi.

Startup DB connect → replica-set/session → collection/index/defaultlar → HTTP
listen. Xatoda xizmat ochilmaydi. Production frontend build ham talab qilinadi.
SIGTERM/SIGINT bir marta drain, HTTP close, DB disconnect; 10 soniyadan keyin
majburiy exit. Notification fon batchi to‘liq drain qilinmaydi: failed yoki
UNKNOWN_OUTCOME holatni tekshiring, ko‘r-ko‘rona resend qilmang.

## Release checklisti

- [ ] Operator origin/main eng yangi SHA va tasdiqlangan release SHAni solishtirsin.
- [ ] Aynan release SHA uchun CI verify muvaffaqiyatli; required checks va branch
  protectionni Dashboard/GitHubda tekshirsin. Lokal PASS remote CI PASS degani emas.
- [ ] Render repo/branch, deployed SHA, build/start, health path, plan, region,
  auto-deploy/preview va instance sonini tekshirsin. Blueprintni ko‘r-ko‘rona apply qilmang.
- [ ] Oxirgi yaxshi deploy/artifact ID, commit, log va mavjud rollback usulini
  yozib oling. Rebuild kerak bo‘lsa dependency/artifact mavjudligini tekshiring.
- [ ] Migration/index/default o‘zgarishini ko‘ring. Oldingi kod yangi schema bilan
  ishlaydimi? Expand/contract, nullable/additive yo‘l va staging testi bo‘lmasa
  release to‘xtasin. Destructive migration bu fazada yo‘q.
- [ ] Riskli releasedan oldin backup completed va recovery point yangiligini,
  key access va yaqindagi isolated restore dalilini DB mas’uli tasdiqlasin.
- [ ] Owner aniq commit, vaqt oynasi va rollback rejasiga insoniy ruxsat bersin.
  Bu hujjat deploy ruxsati emas. Render deploy/rollback API bu fazada chaqirilmadi.
- [ ] Operator tasdiqlangan usul bilan deploy qiladi. `/api/ready` 200, `/api/health`,
  frontend, sintetik login va ikki tenant smoke; real billing yozuvlarini yaratmang.
- [ ] 5xx, latency, startup/index, restart/OOM, auth va notification loglarini
  oldingi baseline bilan kuzating. Sir, cookie va student PII logga qo‘shilmasin.
- [ ] Birinchi 15–30 minut faol kuzatuv va keyingi scheduler siklini tekshiring.

## Qaytarish qarori

Readiness barqaror 503, startup sikli, asosiy login/CRM ishlamasligi yoki sezilarli
5xx regressiyada rolloutni to‘xtating va ownerga xabar bering. Tenant exposure,
ledger buzilishi yoki migration shubhasida darhol incident containmentni boshlang.
Incident rahbari kod rollbackning DBga mosligini DB mas’uli bilan tekshiradi.
Mos bo‘lsa operator oxirgi yaxshi deployni Renderdagi mavjud mexanizm bilan
qaytaradi; mavjud artifact yo‘q bo‘lsa tasdiqlangan oldingi commit rebuildini
rejalaydi. Eski artifact saqlangan deb taxmin qilmang.

Rollbackdan keyin readiness, smoke, commit va loglarni qayta tekshiring.
Moslik noma’lum bo‘lsa eski kodni yoqmang: maintenance/containment va tuzatuvchi
release yoki isolated DB recovery rejasiga eskalatsiya qiling. DB restore bilan
rollbackni aralashtirmang. Avvalgi yaxshi commit DBdagi yangi valid yozuvlarni
bekor qilishga ruxsat bermaydi.
