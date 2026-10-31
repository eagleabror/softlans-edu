# iPhone va Render Free: Super Adminni GitHub Actions orqali yaratish

## Qaror va xavfsizlik chegarasi

Bu usul Render Shell yoki One-off Jobs talab qilmaydi. GitHub runner mavjud `super-admin.ts` skriptining kompilyatsiya qilingan variantini ishga tushiradi. Ilovaga ommaviy endpoint qo‘shilmaydi, Render konfiguratsiyasi yoki JWT kaliti o‘zgarmaydi. Workflow’ni qo‘shish, merge yoki deploy qilish akkaunt yaratmaydi: uni alohida qo‘lda boshlash kerak.

Tekshiruv vaqtida `eagleabror/softlans-edu` public repository edi; GitHub Free’da environment himoyalarini sozlash mumkin. Repository visibility o‘zgarsa, tarif shartlarini qayta tekshiring.

Standard GitHub-hosted runner doimiy IP bermaydi. Shu sabab butun GitHub IP diapazonlari yoki `0.0.0.0/0` ochilmaydi. Workflow aynan o‘sha jobning IPv4 manzilini ko‘rsatadi va siz Atlas’da vaqtinchalik `/32` ruxsat qo‘shguncha 15 daqiqagacha ulanishni kutadi. IP aniqlash, kutish va provisioning bir jobda, bir runnerda bajariladi. Har yangi run/re-run boshqa IP olishi mumkin. Ruxsat hali tarqalmaganida skript ulanishni takrorlaydi; yozish amalini takrorlamaydi.

Bu to‘liq avtomatik tarmoq boshqaruvi emas. Workflow Atlas API kalitiga ega emas va IP ruxsati/DB foydalanuvchisini avtomatik o‘chira olmaydi. Atlas’dagi vaqtinchalik yozuv expiry’si qo‘shimcha himoya; ish tugashi bilan qo‘lda bekor qilish shart. Tarmoq cheklovi yoki runnerning HTTPS va MongoDB egress manzillari farqi sabab `/32` ishlamasa, allowlistni kengaytirmang; pastdagi muqobilni ishlating.

## Bir marta tayyorlash

iPhone Safari’da GitHub/Atlas oching; zarur bo‘lsa **Request Desktop Website** rejimini yoqing. Faqat o‘zingizning ishonchli repository va Atlas loyihangiz bilan ishlang.

1. PR kodini tekshirib, `main`ga merge qiling. `.github/workflows/provision-super-admin.yml` default branchga kelmaguncha Actions’da Run workflow chiqmasligi mumkin. Bu yo‘riqnoma hech narsani avtomatik merge/deploy qilmaydi.
2. GitHub → repository → **Settings → Environments → New environment**: `super-admin-provisioning`.
3. **Deployment branches and tags** orqali faqat `main` branchga ruxsat bering (taglarga emas). Buni secret qo‘shishdan oldin bajaring. Imkon bo‘lsa **Required reviewers** va boshqa ishonchli reviewer qo‘shing, self-review/bypass’ni cheklang. `main`ni review bilan himoyalang. Workflow’dagi `if` tekshiruvi environment branch himoyasining o‘rnini bosmaydi: boshqa branch kodi o‘zgartirilishi mumkin.
4. GitHub plan/repository visibility cheklovlarini tekshiring. Private repositoryda environment secrets/protection yoki required reviewer imkoniyati tarifga bog‘liq. Kerakli main-only environment himoyasini sozlay olmasangiz, secretlarni oddiy repository secretlariga ko‘chirmang va repositoryni public qilmang; muqobil usulni tanlang. Workflow environment nomini yozishning o‘zi himoyani avtomatik yaratmaydi.
5. Atlas → **SoftLans Edu 2.0** → kerakli cluster va database’ni aniqlang. Deploy qilingan ilovaning bazasi bilan mosligini tekshiring. Dastlabki tekshiruvda bu `Cluster0` / `softlans_edu_demo` edi; keyinchalik o‘zgargan bo‘lishi mumkin.
6. Atlas **Database Access** orqali alohida vaqtinchalik DB foydalanuvchisi yarating. Render ishlatadigan doimiy DB foydalanuvchisini ishlatmang yoki o‘zgartirmang. Eng kam vakolat: target database’ning faqat `users` collection’i uchun `find`, `insert`, `listIndexes` amallariga ruxsat beradigan custom database role. `update`, `remove`, boshqa collection yoki administrator roli kerak emas. Cluster access’ni ham aynan kerakli cluster bilan cheklang. Custom role o‘rniga keng `atlasAdmin` huquqini bermang. Vaqtinchalik database user expiry mavjud bo‘lsa, uni ham yoqing.
7. Atlas Connect orqali shu vaqtinchalik foydalanuvchi uchun `mongodb+srv://` URI tayyorlang. URI’da database nomi aniq bo‘lsin; username/parol URI-encode qilingan bo‘lishi kerak. Buni faqat parol menejeri va GitHub Secret maydonida saqlang. Skript GitHub’da `.mongodb.net` hostini, database mosligini va TLS’ni saqlaydigan query parametrlarini tekshiradi. Ruxsatli parametrlar: `retryWrites=true`, `w=majority`, `authSource=admin`, `appName`. URI’ni workflow inputiga, issue, PR yoki chatga yozmang.

Ilova oldin ishga tushgan, `users` collection’i va to‘liq unique `email` indeksi yaratilgan bo‘lishi kerak. Provisioning endi barcha CRM collection/indexlarini yaratmaydi; email indeksi yo‘q bo‘lsa xavfsiz tarzda to‘xtaydi. Index talabini chetlab o‘tmang.

## GitHub Environment Secrets va variable

Aynan **Settings → Environments → super-admin-provisioning** ichida qo‘shing:

| Turi | Nomi | Qiymat |
| --- | --- | --- |
| Secret | `PROVISION_MONGODB_URI` | Vaqtinchalik DB foydalanuvchisining Atlas SRV URI’si, aniq database bilan |
| Secret | `SUPER_ADMIN_EMAIL` | Yangi, boshqa akkauntda ishlatilmagan email |
| Secret | `SUPER_ADMIN_NAME` | Platforma operatori ismi |
| Secret | `SUPER_ADMIN_PASSWORD` | Parol menejerida yaratilgan tasodifiy kuchli parol: kamida 12 belgi, ko‘pi bilan 72 UTF-8 bayt |
| Variable | `PROVISION_EXPECTED_DATABASE` | URI bilan bir xil database nomi, masalan `softlans_edu_demo` |

`JWT_SECRET`, Render API key yoki Atlas boshqaruv API kaliti kerak emas. Provisioning run uchun shell tracing (`set -x`), `ACTIONS_STEP_DEBUG` yoki `ACTIONS_RUNNER_DEBUG`ni yoqmang. Login parolini shaxsiy parol menejerida saqlang: GitHub secret saqlangach uning qiymatini qayta ko‘rsatmaydi. GitHub Actions Secrets — vaqtinchalik yetkazish mexanizmi, parolni keyin olish ombori emas.

## iPhone’dan ishga tushirish

1. GitHub → **Actions → Super Admin — bir martalik yaratish → Run workflow**.
2. Branch: **main**. `confirmation`: **CREATE**. Bu inputga email, URI yoki parol yozmang.
3. Environment approval yoqilgan bo‘lsa, belgilangan reviewer tasdiqlaydi. Tasdiqlanguncha runner boshlanmaydi.
4. **Atlas uchun shu runner IP manzili** step logini oching. Unda faqat ommaviy runner IP manzili va `/32` ko‘rsatiladi. Step tugagach Summary’da ham yoziladi; run tugashini kutmasdan step logidan nusxalang.
5. Atlas → **Database & Network Access → IP Access List → Add IP Address**: ko‘rsatilgan runner manzilini `/32` bilan kiriting. **Add Current IP Address**ni bosmang — bu iPhone IP’sini qo‘shadi. **Temporary** ruxsatni yoqing, **6 hours** tanlang. Izohga run raqamini yozish mumkin; credential yozmang. Mavjud Render ruxsatlarini o‘chirmang.
6. GitHub run’iga qayting. Keyingi step 15 daqiqagacha ulanishni kutadi; ruxsat tarqalgach akkaunt yaratiladi. Uzoq vaqt kutib qolsa yoki xato bo‘lsa, URI/parolni logga chiqarib tekshirmang.
7. `Super Admin yaratildi` natijasidan so‘ng [login sahifasi](https://softlans-edu-demo.onrender.com/login)ga Environment Secrets’da belgilagan email/parol bilan kiring. `/super-admin` ochilishi kerak.

Workflow faqat qo‘lda dispatch qilinadi, 25 daqiqa job timeout bor, parallel runlar bitta concurrency guruhida ketma-ket bajariladi. U birinchi Super Admin mavjud bo‘lsa, hatto boshqa email berilsa ham to‘xtaydi. Bu repository ichidagi runlarni tartiblaydi; boshqa operator ayni paytda boshqa vosita orqali provisioning qilmasligi kerak. Email unique indeksi bir email uchun parallel insertlarni ham himoyalaydi. Bu workflow hisobni o‘chirish, reset qilish yoki ikkinchi Super Admin yaratish vositasi emas.

## Darhol tozalash — muvaffaqiyat, xato yoki Cancel’dan keyin ham

1. Atlas’da aynan vaqtinchalik provisioning DB foydalanuvchisini o‘chiring. Bu credentialni haqiqatan bekor qiladi; faqat GitHub secretni o‘chirish yetarli emas. Render’ning doimiy DB foydalanuvchisiga tegmang.
2. Atlas’da shu run uchun qo‘shilgan `/32` yozuvni o‘chiring; 6 soat expiry’ni kutmang. Cancel/timeout holatida ham buni bajaring. Job yakunidagi eslatma force-cancel’da ishlamasligi mumkin.
3. GitHub Environment’dan to‘rtta provisioning secretni olib tashlang. `PROVISION_EXPECTED_DATABASE` maxfiy emas, lekin environmentni ham o‘chirish mumkin.
4. **Actions → workflow → … → Disable workflow**. Yana kerak bo‘lmasa keyingi PR’da workflow’ni olib tashlash mumkin. Environment himoyasini saqlang.
5. Ilova Super Admin login parolini parol menejerida saqlang. GitHub’dagi `SUPER_ADMIN_PASSWORD` secretini o‘chirish yangi akkaunt parolini bekor qilmaydi — u normal login uchun kerak. Uni o‘zgartirish alohida parol reset amali bo‘ladi; bu workflow buni bajarmaydi.
6. URI/parol xato ravishda log/chatga yozilgan bo‘lsa, logni o‘chirish bilan cheklanmay, oshkor bo‘lgan credentialni almashtiring/bekor qiling.

## Xatolar va xavfsiz muqobil

- **Skip:** repository/branch yoki `CREATE` tasdig‘i mos emas. Faqat ushbu repositoryning main branchidan ishga tushiring.
- **Ulanish kutishdan so‘ng xato:** runner `/32`, Atlas holati, credential va database nomini maxfiy maydonlarda tekshiring. Eski run IP’sini yangi run uchun qayta ishlatmang. `0.0.0.0/0` qo‘shmang.
- **Provisioning rad etildi:** email band, Super Admin mavjud, unique indeks yo‘q yoki DB huquqlari yetarli emas bo‘lishi mumkin. Xatoda ichki ma’lumot ataylab chiqarilmaydi. Mavjud tenant akkaunti yangilanmaydi; boshqa hisobni avtomatik ko‘tarish yo‘q.
- **Run bekor bo‘ldi yoki yozish natijasi noaniq:** yangi email bilan takrorlashga shoshilmang. Avval tanlangan email/parol bilan loginni sinang yoki vakolatli operator faqat `role: super_admin` akkauntlar mavjudligini tekshirsin. Insert serverda bajarilib, javob yetib kelmagan bo‘lishi mumkin.
- **Amaliy muqobil:** iPhone Safari orqali ishonchli GitHub Codespaces yoki tashkilotning browser terminalidan foydalaning. Aynan tekshirilgan `main` kodini oching; credentiallarni repositoryga bog‘langan Codespaces Secrets yoki tashkilot secret manager’i orqali bering, terminal buyruqlariga qiymatlarni yozmang. Terminal muhitining IPv4 manziliga Atlas’da vaqtinchalik `/32` qo‘shib, mavjud `npm run provision:super-admin` buyrug‘ini ishlating. Shell’ga `.env`, `env`, `printenv` yoki secret qiymatlarini chiqarishni buyurmang. Xuddi shu tozalashni bajaring va Codespace’ni o‘chiring. Availability/xarajat va mobil terminal qulayligini oldindan tekshiring.
- Doimiy boshqaruv uchun yaxshiroq variant: tashkilot boshqaradigan statik egress IP’li ishonchli runner/browser terminali. GitHub larger runner statik IP imkoniyati tarifga bog‘liq. Standard hosted runner IP’sini doimiy allowlistga aylantirmang.

## Tekshirilgan rasmiy manbalar

- [Atlas IP Access List](https://www.mongodb.com/docs/atlas/security/ip-access-list/) — vaqtinchalik yozuvlar, `/32`, 6 soat/1 kun/1 hafta expiry.
- [GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) — o‘zgaruvchan IP diapazonlari va statik IP’li larger runnerlar.
- [GitHub environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments) — environment secrets, protection va tarif cheklovlari.

Mahalliy tekshiruvlar faqat vaqtinchalik MongoDB replica setdan foydalanadi. Haqiqiy Atlas foydalanuvchisi, access list, GitHub Secrets yoki Super Admin hisobi bu PR tayyorlanayotganda yaratilmagan/o‘zgartirilmagan. Haqiqiy GitHub dispatch va Atlas `/32` propagatsiyasi operatorning yuqoridagi qadamlari bilan alohida tekshiriladi.

## PR tekshiruv natijalari

- `npm test`: API 373/373, frontend 77/77 — jami 450 test muvaffaqiyatli; provisioning uchun 9 ta yangi test.
- `npm run typecheck`, `npm run build`, `git diff --check` va `actionlint` muvaffaqiyatli.
- Action versiyalarining to‘liq SHA qiymatlari rasmiy GitHub taglari bilan solishtirildi.
- To‘liq va production dependency audit: yuqori/kritik topilma yo‘q; mavjud `exceljs`/`minimatch` zanjirida 8 ta o‘rta darajadagi ogohlantirish mavjud. Dependency va lockfile bu o‘zgarishda yangilanmadi.
