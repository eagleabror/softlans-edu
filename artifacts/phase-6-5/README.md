# Phase 6.5 — audit dalillari

2026-11-07 UTC; baseline main `37026a253e687508d2bebdbfda8a609af963a9b5`.
Faqat disposable loopback MongoDB 7.0.24 replica set va sintetik ma’lumotlar.
Natijalar production xizmat/backup/delivery tasdig‘i emas.
Saqlangan stdout loglarda faqat satr oxiri bo‘shliqlari va oxirgi bo‘sh satrlar
normalizatsiya qilindi; test natijalari va xato matnlari saqlangan.

| Dalil | Natija |
| --- | --- |
| [revision.txt](revision.txt) | Phase 6.6.1/2/3.1/3.2 merge ancestry |
| [github-runs.json](github-runs.json) | GitHub read-only Actions metadata: main CI success, kuzatilgan 3 scheduler run skipped; jami 78 run ko‘rildi |
| [main-tests.txt](main-tests.txt) | Baseline: API 554 passed + 1 skipped, web 136 passed |
| [typecheck-main.txt](typecheck-main.txt), [build-main.txt](build-main.txt) | Main typecheck/build exit 0 |
| [audit-all.json](audit-all.json), [audit-production.json](audit-production.json) | 0 vulnerabilities; `npm ci` lockfile asosida |
| [regression-before.txt](regression-before.txt) | H1 main’da 2 failed / 22 passed; kutilgan failing evidence, qolgan yakuniy test failure emas |
| [regression-after.txt](regression-after.txt) | H1 minimal fixdan keyin 24 passed |
| [lifecycle.txt](lifecycle.txt) | Enrollment→P&L zanjiri uch sintetik tenantda, 1 yaxlit integration test passed |
| [recovery.txt](recovery.txt) | 3 passed; native encrypted restore, 56 kolleksiya; populated payroll/payout/cash/expense ham tekshirildi; recoveryMs 4386, productionVerified=false |
| [final-tests.txt](final-tests.txt) | Yakuniy branch: API 557 passed + 1 skipped; web 136 passed; jami 693 passed |
| [typecheck-final.txt](typecheck-final.txt), [build-final.txt](build-final.txt) | Yakuniy branch typecheck/build natijalari |

Test buyruqlari repository root’dan:

```sh
npm ci
npm test
npm run typecheck
npm run build
npm audit --json
npm audit --omit=dev --json
npm test -w @softlans/api -- tests/management-reports.test.ts
npm test -w @softlans/api -- tests/pilot-financial-lifecycle.test.ts
# mongodump va mongorestore PATHda, faqat sintetik harness:
npm run test:recovery
git diff --check
```

Muhit: Node 24.19.0, npm 11.9.0, Linux amd64. Main CI Node22da success;
mahalliy natijalarni Node22 runtime parity deb ko‘rsatmang.
Restore Tools 100.14.0 rasmiy HTTPS manbadan workspace’ning ignored work/
katalogiga olindi:
`https://fastdl.mongodb.org/tools/db/mongodb-database-tools-ubuntu2204-x86_64-100.14.0.tgz`.
Lokal SHA256: `4104998bda784a0cb16fc2e06d9c21645516d72c4fb481c9b103f1e0a8458fc0`.
Bu lokal hash artifact identifikatori; mustaqil vendor checksum/signature tasdig‘i emas
(`.sha256` va `.sha256sum` URLlari 403 qaytardi).
Tools/binary/archive/backup Gitga qo‘shilmagan. Shifrlangan sintetik backup
va kalit drill oxirida tozalanadi; vaqtinchalik bazalar to‘xtatiladi.

Native drillning odatiy `npm test`dagi skip’i expected; alohida recovery.txt
muvaffaqiyatiga qarang. Kichik quiescent lokal drill production hajmi,
parallel writes, PITR, retention, offsite, KMS access yoki actual RPO/RTOni
isbotlamaydi. Moliyaviy fixturelar test-only; real bank/Telegram/email ishlatilmaydi.

[Qaror, checklist va operator amallari](../../docs/phase-6-5-pilot-readiness.md).
