# SoftLans Edu 2.0 — Phase 1

A TypeScript monorepo for an education-center CRM in Uzbekistan. Phase 1 implements center registration, cookie authentication, tenant isolation, four roles, a dashboard, and team account creation. All application interface text is Uzbek. Student management, courses, attendance, billing, messaging, password recovery, and subscriptions are outside this phase.

## Prerequisites

- Node.js **22.12+** (Node 22 LTS recommended), npm 10+, and Git.
- MongoDB 7+ **replica set** or MongoDB Atlas. Transactions are required; standalone MongoDB cannot register a center.
- Windows: PowerShell and either Docker Desktop with Linux containers/WSL2, or MongoDB Community Server plus `mongosh`.

## Windows setup (PowerShell)

```powershell
git clone https://github.com/eagleabror/softlans-edu.git
cd softlans-edu
git checkout feat/phase-1-foundation
npm ci
Copy-Item apps/api/.env.example apps/api/.env
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
notepad apps/api/.env
```

Paste the generated value into `JWT_SECRET` in the **ignored** `.env`. Do not reuse it across environments or commit it. Keep `APP_ORIGIN=http://localhost:5173` with no trailing slash for development. The frontend uses relative `/api` requests and Vite proxies them to port 4000; it needs no secret or `.env` file.

Start the development database with Docker Desktop:

```powershell
docker compose up -d --wait
npm run dev
```

Open **http://localhost:5173** and choose **Hisob ochish**. Registration atomically creates a new center and its Business Owner. There is no role or tenant selector. The first dashboard has one team member; use **Jamoa → A’zo qo‘shish** to add an administrator or teacher. Every email is globally unique; Phase 1 supports one center per user account.

If port 5173 is occupied, stop the other service. Vite deliberately fails rather than choosing a port that does not match the allowed origin. Use `localhost` consistently; `127.0.0.1` is a different origin.

### MongoDB without Docker

Stop any existing Windows MongoDB service using port 27017, or use another port and update the URI. In one PowerShell window (adjust the installed version/path):

```powershell
New-Item -ItemType Directory -Force .\work\mongo-data
& 'C:\Program Files\MongoDB\Server\7.0\bin\mongod.exe' --dbpath "$PWD\work\mongo-data" --replSet rs0 --bind_ip 127.0.0.1 --port 27017
```

In another window:

```powershell
mongosh --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"localhost:27017"}]})'
mongosh --eval 'rs.status().ok'
npm run dev
```

Or set `MONGODB_URI` to your Atlas connection URI, keeping credentials only in `.env` or a secret manager. The supplied Compose file is a local, unauthenticated development database bound to loopback. It must never be used as a production database configuration. `docker compose down` preserves data; removing the volume deletes it.

## Commands and layout

| Command                         | Purpose                                       |
| ------------------------------- | --------------------------------------------- |
| `npm run dev`                   | Express API on 4000 + Vite web on 5173        |
| `npm run typecheck`             | Check API, shared contracts, and web          |
| `npm test`                      | API unit/integration tests and React tests    |
| `npm run test:unit`             | API security, validation, configuration tests |
| `npm run test:integration`      | Real HTTP + temporary MongoDB replica set     |
| `npm run build`                 | Compile API and build frontend                |
| `npm start`                     | Run compiled single-origin production service |
| `npm start -w @softlans/api`    | Run compiled API from its workspace           |
| `npm run seed:dev`              | Explicit, development-only sample data        |
| `npm run provision:super-admin` | Create a platform operator out of band        |

```text
apps/api/src/       Express app, models, security, scripts
apps/api/tests/     Unit and real-MongoDB integration tests
apps/web/src/       React, accessible forms, responsive Tailwind/CSS UI
packages/contracts Shared TypeScript response types and roles
```

`createApp` is separate from startup so Supertest exercises the same middleware and routes as the server. Password hashes and session versions are excluded from queries by default, and all responses use explicit allowlists. The frontend never stores tokens in JavaScript or local storage. API responses include a request ID and safe Uzbek errors; logs omit request bodies, cookies and raw infrastructure errors.

### Tests

Integration tests download MongoDB **7.0.24** on their first run and start a disposable single-node replica set. No production secrets or running application database are needed. This requires network access to `fastdl.mongodb.org`, writable `work/`, local process/port access, and MongoDB OS libraries (`libssl3` on modern Linux).

To use an existing **dedicated test** replica set if downloads are unavailable:

```powershell
$env:TEST_MONGODB_URI='mongodb://127.0.0.1:27017/softlans_edu_test?replicaSet=rs0'
npm run test:integration
Remove-Item Env:TEST_MONGODB_URI
```

Tests delete users and tenants in that database. The path must be exactly `/softlans_edu_test`; never point it at an application database. An alternative is to set `MONGOMS_SYSTEM_BINARY` to a locally installed `mongod` executable. Tests do not seed a running application or skip failures when MongoDB is unavailable. React tests cover Uzbek authentication, request payloads, failure recovery and role-aware navigation. Integration tests cover tenant ID spoofing, cross-tenant direct-object access, roles, session revocation, disabled accounts/centers, transaction rollback and concurrency, injection, CSRF, limits, and safe errors.

## Authentication and tenant boundaries

- Public registration accepts only `name`, `email`, `password`, `centerName`. Extra fields are rejected. Both tenant and owner are created in one transaction; unique email indexing resolves races without orphan tenants.
- Login accepts email and password only. Passwords are bcrypt-hashed with cost 12; registration enforces at least 12 characters and at most **72 UTF-8 bytes**, preventing bcrypt truncation.
- JWTs expire in one hour and contain only subject, session version and standard claims. Verification pins HS256, issuer and audience. JWT roles and tenant IDs are never accepted as authorization sources.
- Every authenticated request loads the user, current role, active state, session version and active tenant from MongoDB. `tenantScope(actor)` fails closed without membership and adds the server-derived tenant constraint to every tenant user query, count, lookup and creation. Client tenant IDs in body, query or headers cannot select a tenant. Future tenant data must follow this pattern.
- Logout increments the user’s session version and expires the cookie, invalidating **all** current sessions for that user. Deactivated users/tenants are rejected on their next request. Role changes are immediately observed.
- Cookies use `HttpOnly`, `SameSite=Strict`, `/api`, no Domain, one-hour expiry, and `Secure` in production. Deploy frontend and API on the **same origin**, behind HTTPS. Cross-site cookie hosting is deliberately unsupported.
- Every state-changing request, including login and registration, requires an exact configured `Origin` and `application/json`. This prevents login CSRF as well as authenticated CSRF. CORS permits only the configured origin with credentials; it is not used as the sole CSRF defense. CLI clients must explicitly send the allowed Origin and JSON.
- Tenant reads require authentication and ownership-scoped filters. Foreign member IDs return the same 404 as nonexistent IDs. Teacher dashboards do not disclose team counts. Super Admin has platform totals only and no implicit tenant data bypass.

| Role           | Dashboard            | Team list / detail | Create Admin | Create Teacher |
| -------------- | -------------------- | ------------------ | ------------ | -------------- |
| Super Admin    | Platform totals      | No                 | No           | No             |
| Business Owner | Own center totals    | Own center         | Yes          | Yes            |
| Admin          | Own center totals    | Own center         | No           | Yes            |
| Teacher        | Own account / center | No                 | No           | No             |

There are no user update, delete, transfer, promotion, impersonation, or public Super Admin endpoints in Phase 1. The API does not accept a bearer token as a substitute for the cookie.

### API

| Method | Path                                    | Access                                             |
| ------ | --------------------------------------- | -------------------------------------------------- |
| GET    | `/api/health`, `/api/ready`             | Liveness / DB readiness                            |
| POST   | `/api/auth/register`, `/api/auth/login` | Public, strict validation and rate limits          |
| GET    | `/api/auth/me`                          | Current authenticated session                      |
| POST   | `/api/auth/logout`                      | Revoke authenticated user sessions                 |
| GET    | `/api/dashboard`                        | Role-specific summary                              |
| GET    | `/api/team?page=1`                      | Owner/Admin; 20 results per page                   |
| GET    | `/api/team/:id`                         | Owner/Admin; own center only                       |
| POST   | `/api/team`                             | Owner/Admin; name, email, password, permitted role |

An error has `{ "error": { "code": "…", "message": "…", "requestId": "…", "fields": {} } }` (`fields` appears for validation). Unknown routes return JSON 404; payloads larger than 16 KiB return 413. Login errors do not distinguish an unknown, disabled or incorrect account. Registration conflicts are a generic 409.

### Super Admin provisioning

There is **no public Super Admin registration**. An authorized operator with database/runtime access may temporarily set `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_NAME`, and a strong `SUPER_ADMIN_PASSWORD` in `apps/api/.env` or injected environment variables, then run:

```powershell
npm run provision:super-admin
```

The create-only script refuses existing emails and never promotes a center account. Remove those three credentials immediately after running it. The operator then uses the normal login UI. Do not put passwords in command arguments, source, screenshots or logs.

### Optional development sample data

Only against a development database, set `NODE_ENV=development`, `SEED_DEMO=true`, and a locally chosen strong `SEED_PASSWORD` in the ignored API `.env`, then run `npm run seed:dev`. This creates one labeled demo center and three accounts:

- `owner@demo.softlans.test`
- `admin@demo.softlans.test`
- `teacher@demo.softlans.test`

All use the supplied seed password. The script refuses production/test modes and duplicate demo emails, uses a transaction and never deletes existing data. Remove the seed password and set `SEED_DEMO=false` after use. No demo data or credentials are bundled into the frontend or created on startup.

## Deployment assumptions and Phase 1 limits

For the public Render demo, follow the [Render + MongoDB Atlas deployment guide](docs/render-demo.md). It includes exact Dashboard fields, Atlas database-user and network setup, environment variables, demo account policy, and verification steps. The root `render.yaml` is an optional Blueprint for one Node Web Service; apply it only after this change is merged into `feat/phase-1-foundation`. Auto-deploy is off. No deployment, account connection or automatic seed is performed by this change.

Build from the repository root with `npm ci --include=dev && npm run build && npm prune --omit=dev` and run `npm start` with production variables injected. Express serves `apps/web/dist` and `/api` behind one HTTPS origin, binds `0.0.0.0` using `process.env.PORT`, and handles React Router navigation/refresh. Unknown API routes stay JSON 404s. Production startup refuses a missing frontend build or a MongoDB server without replica-set sessions. Set the Render health check to `/api/ready`; `/api/health` remains liveness. No separate frontend service, rewrite rules or frontend secrets are needed.

Set `DEMO_MODE=true` and `PUBLIC_REGISTRATION_ENABLED=false` for a public demo. Demo mode closes registration by default; an explicit registration flag overrides that default. Both flags accept only `true` or `false`. Local development registration remains enabled with the supplied `.env.example`. Disabling registration is enforced by the API before database writes; the form displays a safe Uzbek message. Existing login, tenant isolation, roles, cookies and CSRF checks remain enforced. Demo mode is not a read-only sandbox: use fictional data, arrange reviewer credentials privately, never publish administrator passwords, and never run development seeds on Render.

Set `NODE_ENV=production`, a strong unique `JWT_SECRET`, HTTPS `APP_ORIGIN`, and a least-privilege authenticated TLS MongoDB replica-set URI. The service creates required collections and indexes at startup and refuses to listen when setup fails. Coordinate index changes as deployment migrations as the schema evolves. Keep database backups and verify restoration before handling real customer data.

`TRUST_PROXY_HOPS` defaults to 0. Only set it to the exact number of trusted reverse proxies, with direct access to Express blocked and forwarded headers overwritten by the edge. Otherwise IP rate limits can be spoofed. API-wide limit: 300 requests/15 minutes/IP; login: 15/15 minutes/IP; registration: 5/hour/IP; team creation: 20/hour/IP. Limits use an **in-process store** in Phase 1. Run a single API instance or add a shared store (such as Redis) before scaling across instances; edge rate limits are also appropriate for center networks sharing one IP. Rate limits reset on restart.

This is a production-oriented foundation, not a completed production launch: password reset/change, MFA, email verification, invitations, security audit history, distributed throttling, monitoring/alerting and operator recovery workflows remain future work. New team accounts currently receive an initial password chosen by their administrator and delivered outside the application. There is no profile editing or password-management UI in Phase 1. Login and team data are real database operations; the UI deliberately shows no invented students, revenue or attendance metrics.

The Sites hosting runtime uses Workers and cannot run this required Node/Express/Mongoose TCP service. This project retains the requested stack and PR workflow; deploy to a Node-capable host with MongoDB rather than substituting another database or publishing a disconnected frontend.
