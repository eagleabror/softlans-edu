# Render + MongoDB Atlas public demo

This guide is for an operator to use **after reviewing and merging the deployment
PR into `feat/phase-1-foundation`**. Preparing this repository does not deploy it,
connect an account, or create a database. This is a public demo, not a production
launch. Use only fictional people, centers and email addresses; do not upload
student, teacher or customer records.

## Deployment contract

- One Render **Node Web Service**, one instance, serves Express `/api` and the Vite
  build at the same HTTPS origin. No separate Static Site, CDN, Vite server,
  frontend API URL, or Render redirect/rewrite rules are needed.
- Build from the repository root with
  `npm ci --include=dev && npm run build && npm prune --omit=dev`.
  Build tools are installed even with `NODE_ENV=production`; pruning happens only
  after both builds. Start from the repository root with `npm start`.
- Express listens on `0.0.0.0:$PORT`; Render supplies `PORT` (normally `10000`).
  Render terminates HTTPS. Plain HTTP between Render's edge and Node is expected;
  application cookies remain `Secure` in production.
- `APP_ORIGIN` is exactly the browser's HTTPS origin. For example,
  `https://softlans-edu-demo.onrender.com` is a **format example**, not a reserved
  hostname. No trailing slash, path, query, fragment, wildcard, or comma-separated
  list. The parser rejects noncanonical origins and HTTP in production; write
  requests must carry an Origin that matches character for character. The app
  cannot discover your chosen hostname: confirm the assigned URL in Render.
- `TRUST_PROXY_HOPS=1` assumes the standard direct Render HTTPS edge → Node path.
  The last forwarded client IP is used, not an arbitrary leftmost forwarded IP.
  Keep direct access to Node blocked. Adding another proxy requires verifying
  the forwarding path, header replacement and exact trusted hop count before
  changing this value. Never use `true` or an arbitrary higher count.
- MongoDB must support replica-set sessions and transactions. Startup checks
  `hello`, creates collections/indexes, and refuses to listen if setup fails.
  Registration keeps the existing atomic tenant + owner transaction.
- `/api/health` is process liveness; `/api/ready` returns `200 {"ready":true}`
  only while Mongoose is connected, otherwise `503 {"ready":false}`. Use
  `/api/ready` for Render. Probe requests do not spend the API rate-limit budget.
  These public endpoints expose no URI, credentials, topology or stack traces.
- Frontend routes such as `/login`, `/register`, `/team`, `/center` and `/account`
  return the SPA on direct navigation/refresh. Unknown `/api` routes and missing
  assets return safe JSON 404s. Only `apps/web/dist` is served; API source, source
  maps, `.env` files and repository files are outside the static root.

## 1. Prepare a separate MongoDB Atlas demo database

1. In Atlas, create or select a project dedicated to this demo. Choose **Build a
   Database / Create Deployment** and an Atlas replica-set deployment (a supported
   Free M0 or dedicated non-sharded replica set is sufficient for demo traffic). Choose a region
   near the Render service. Do not use standalone MongoDB or the local Compose
   database. Do not load Atlas sample datasets or any real customer data.
2. Under **Security → Database Access → Add New Database User**, create a unique
   password-authenticated application user. Under **Specific Privileges**, grant
   `readWrite` only on a new database named `softlans_edu_demo`. This permits the
   application's collection/index initialization. Do not grant Atlas/project
   administration or access to unrelated databases. Store the random password
   privately; it is not an application login.
3. Under the cluster's **Connect → Drivers**, select Node.js and copy the
   `mongodb+srv://` connection string. Include `/softlans_edu_demo` before `?` and
   keep `retryWrites=true&w=majority`. URL-encode the username/password individually
   if they contain reserved characters. The shape is:

   ```text
   mongodb+srv://<encoded-user>:<encoded-password>@<atlas-cluster>/softlans_edu_demo?retryWrites=true&w=majority
   ```

   Atlas SRV discovers its replica set and enables TLS; do not invent a
   `replicaSet` name, set `directConnection=true`, disable TLS, or allow invalid
   certificates. For a non-SRV driver URI, preserve Atlas's full host list,
   `replicaSet`, TLS and authentication options. Keep the URI only in Render's
   secret environment settings, never in Git, frontend `VITE_*` variables, logs,
   screenshots or PRs.
4. Under **Security → Network Access → Add IP Address**, allow only Render's
   reported outbound IPv4 addresses/CIDRs for the chosen service/region. After
   creating the Render service, find them in its **Connect → Outbound** menu and
   add every reported range. Wait until Atlas shows the rules as active, then
   deploy/retry the Render service. An initial deploy before this step may fail
   safely. Avoid `0.0.0.0/0` and `::/0`. Add your own temporary operator IP only
   when needed and remove it afterward. Recheck rules if the Render region or
   outbound addresses change.

## 2. Exact Render Dashboard setup (manual Web Service)

Only perform these steps when you intend to deploy. **Create Web Service starts
an initial deployment**; this task has not performed that action.

1. After the PR is merged into `feat/phase-1-foundation`, open Render Dashboard →
   **New + → Web Service**, choose the Git repository
   `eagleabror/softlans-edu`, and authorize repository access yourself if required.
2. Set the following fields:

   | Dashboard field | Value |
   | --- | --- |
   | Name | A unique name, e.g. `softlans-edu-demo` |
   | Language / Runtime | **Node** |
   | Branch | `feat/phase-1-foundation` (with this PR merged) |
   | Region | Near your Atlas deployment |
   | Root Directory | **Leave blank** (monorepo root) |
   | Build Command | `npm ci --include=dev && npm run build && npm prune --omit=dev` |
   | Start Command | `npm start` |
   | Instance Type | Starter; keep exactly **one** instance |
   | Health Check Path (Advanced) | `/api/ready` |
   | Auto-Deploy | **Off** |

   A Free Web Service can be used if available, but may sleep and take time to
   wake; do not mistake its cold start for an application navigation failure.
   No persistent disk, background worker, seed command, pre-deploy command or
   autoscaling is needed. In-process rate limits require one instance and reset
   on restarts; a shared rate-limit store is required before scaling.
3. In **Environment**, add every required row in the table below, plus the two
   demo flags. Set `NODE_VERSION=22`. Use the actual assigned `onrender.com` HTTPS
   URL as `APP_ORIGIN`; confirm the name/URL in Render instead of assuming the
   example name is available. Leave `PORT` to Render. Generate a separate JWT
   secret locally and paste it privately:

   ```sh
   node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
   ```

4. Choose **Create Web Service**. Inspect the service's assigned URL and
   **Connect → Outbound** addresses. Finish the Atlas IP allowlist above. If Render
   assigned a different hostname, fix `APP_ORIGIN` before testing login. Use
   **Manual Deploy → Deploy latest commit** after configuration/network changes
   when another deployment is needed. Never relax the origin check to resolve a
   hostname mismatch.
5. Wait for a successful build, startup and `/api/ready` health check. If startup
   fails, verify variable names, URI/database/user permissions, Atlas network
   rules, cluster availability and build outputs. Logs intentionally show only a
   safe startup message. Do not enable debug routes or print credentials/raw DB
   errors to investigate.
6. Keep the provided Render hostname as the single canonical origin. If you
   later add a custom domain, configure HTTPS first, set `APP_ORIGIN` to that
   exact canonical origin and redeploy. Use only that URL for authentication;
   writes from the old Render hostname will be rejected. Do not broaden CORS or
   switch cookies to `SameSite=None`.

### Optional Blueprint path

The root `render.yaml` expresses the same single-service setup, a paid Starter
instance, manual deploys, and a generated private `JWT_SECRET`. It deliberately
targets `feat/phase-1-foundation`, so use it only after this PR is merged there.
As an alternative to the manual flow, choose **New + → Blueprint**, select the
repository/branch, review its service/region/cost, and supply the `sync: false`
values (`APP_ORIGIN`, `MONGODB_URI`) privately. Confirm the actual hostname and
Atlas egress rules as above. Applying a Blueprint deploys resources; it was not
applied as part of preparing this PR. Choose either Blueprint or manual setup,
not both, to avoid creating duplicate services. Neither path runs seeds or
provisions application accounts.

## Environment variables

| Name | Render demo value / handling |
| --- | --- |
| `NODE_ENV` | **Required:** `production`; controls Secure cookies and frontend serving. |
| `PORT` | Render injects it (normally `10000`); do not hardcode it. Local default is `4000`. |
| `APP_ORIGIN` | **Required:** exact deployed HTTPS origin with no trailing slash. Non-secret. |
| `MONGODB_URI` | **Required secret:** Atlas replica-set URI scoped to `softlans_edu_demo`. |
| `JWT_SECRET` | **Required secret:** unique random value, at least 48 characters; prefer the 96-character hex value generated above. Rotation invalidates existing sessions. |
| `TRUST_PROXY_HOPS` | Set to `1` for the documented direct Render edge path; local default `0`. Must be an integer, not a boolean. |
| `NODE_VERSION` | `22`, selecting Render's current Node 22 release (app requires 22.12+). |
| `DEMO_MODE` | `true` for the public demo. Defaults to `false` when absent. |
| `PUBLIC_REGISTRATION_ENABLED` | `false` for the public demo. If omitted, defaults to `false` when demo mode is on and `true` otherwise. An explicit `true` reopens signup even in demo mode. |

Boolean flags accept only literal lowercase `true` or `false`; ambiguous values
fail startup. Keep both flags set in Render so registration remains closed even
if someone changes `DEMO_MODE`. Local `.env.example` leaves development signup
enabled. Do not create or commit a real `.env`, upload an entire local `.env` to
Render, or put `SUPER_ADMIN_*`, `SEED_PASSWORD` or `SEED_DEMO=true` in the running
demo service. No frontend environment variables are required.

## Demo accounts and registration policy

`DEMO_MODE` closes public signup by default; it is **not** a read-only mode or a
substitute for authorization. Existing users can still log in and use their
Phase 1 permissions, including owner/admin team creation. Tenant isolation,
roles, strict JSON/origin CSRF checks, cookie settings, password hashing and
rate limits remain enforced. Direct `POST /api/auth/register` requests return
403 `REGISTRATION_DISABLED` before hashing or database writes. The existing
registration form displays this safe Uzbek error if submitted; it remains
available locally.

There are no built-in public credentials. Do not publish administrator/owner
passwords in documentation, the UI, a PR or source. Do not run `seed:dev` on
Render; it refuses production mode. Startup and deploys never seed demo or
customer data. If reviewers need accounts, an authorized operator must arrange
fictional demo accounts separately and deliver credentials privately. A temporary
signup opening requires deliberate `PUBLIC_REGISTRATION_ENABLED=true`, affects
the entire public origin, and must be closed immediately afterward; it is not
an invitation or private provisioning mechanism. Super Admin provisioning is
optional, out of band, and unnecessary for a public demo. Do not weaken
`NODE_ENV`, database checks or registration policy to run development scripts.

## Verification before sharing the URL

Local/repository verification (no Atlas credentials required):

```sh
npm ci
npm run typecheck
npm test
npm run build
npm audit --audit-level=high
npm audit --omit=dev --audit-level=high
git diff --check
```

Tests use a disposable MongoDB 7.0.24 replica set plus a standalone instance to
verify startup rejection; the first run downloads `mongod`. Existing Phase 1
security/tenant/React tests are retained, with deployment tests added. To smoke
test the compiled production server locally, inject a disposable replica-set URI,
a temporary JWT secret, `NODE_ENV=production`, an HTTPS `APP_ORIGIN`, and a free
`PORT`, then run `npm start`. HTTP liveness/static responses can be checked on
loopback, but Secure cookie browser authentication requires an HTTPS edge. Never
set production cookies insecure just to test on localhost.

After an operator deploys, verify these from the canonical HTTPS origin:

1. `/api/health` returns 200 and `/api/ready` returns 200 with `ready: true`.
2. `/login` loads scripts/styles. Refresh `/team`, `/center` and `/account`:
   logged-out users reach login and logged-in reviewers see role-appropriate
   pages. No missing module/MIME errors should appear.
3. `/api/does-not-exist` returns JSON 404, not the React HTML shell. Missing
   `/assets/does-not-exist.js` also returns 404. No source maps or `.env` are served.
4. With signup closed, `/register` submission returns the safe disabled message;
   verify direct API calls cannot bypass it and create no user or tenant rows.
5. With a privately arranged fictional account, verify login, dashboard, permitted
   team actions and logout. Inspect the session cookie: `HttpOnly`, `Secure`,
   `SameSite=Strict`, `Path=/api`, no `Domain`; no JWT in local storage or JS.
6. Verify a missing/wrong Origin on a JSON POST returns 403. CORS must specify
   only `APP_ORIGIN` and credentials, never `*`. Do not interpret a CORS header
   alone as CSRF enforcement; the write middleware rejects invalid origins.
7. Keep different reviewers/tenants separated. A teacher must not list team data;
   an owner must not read another center's team member by ID. Demo mode grants
   no role or tenant bypass.

The preparation checks are recorded in the PR. Live Render/Atlas connectivity,
assigned hostname, edge forwarding and real HTTPS browser behavior can only be
confirmed after an operator deploys; this preparation does not claim those were
tested. This is still Phase 1: no Phase 2 CRM features, public admin credentials,
automatic seeding or production launch are included.
