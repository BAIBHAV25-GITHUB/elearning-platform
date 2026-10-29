\i# EduStream

An e-learning platform: instructors publish courses (video, PDF and text lessons) with scheduled batches, students
enrol and pay through Razorpay, learn in a player that remembers where they stopped, and receive a verifiable
PDF certificate. Admins moderate users, courses, payments and refunds.

| Part     | Stack                         | Folder                  |
| -------- | ----------------------------- | ----------------------- |
| Client   | React 19, Vite, Tailwind      | [`client/`](client)     |
| API      | Node 22, Express 5, `pg`, zod | [`server/`](server)     |
| Database | PostgreSQL 14+ (tested on 16) | [`database/`](database) |

## Architecture

```mermaid
flowchart LR
    B[Browser: React SPA] -->|/api/v1, JWT| N[nginx or Vite dev server]
    N --> A[Express API]
    A -->|SQL + fn_* functions| P[(PostgreSQL)]
    A -->|signed uploads / URLs| C[Cloudinary: video, PDF]
    A -->|orders, refunds| R[Razorpay]
    R -->|signed webhook| A
    B -->|checkout.js| R
    B -->|media via signed URLs| C
```

Rules that must hold (ownership, seats, payment state, course lifecycle) live in PostgreSQL functions, triggers
and constraints, so they cannot be skipped by a buggy endpoint. The API validates input (zod), authenticates the JWT,
**re-reads the user's status and role from the database on every request** (a banned user is locked out
immediately), checks role and ownership, and calls the functions. The client mirrors the role rules for convenience only.

Layering on the server: `routes` (guards + validation) → `controllers` → `repositories` (SQL) with `services`
for video processing, certificates PDF and payments, `validation/` for the zod schemas.

## Roles

One role per account (decision from Step 4): to learn _and_ teach, use two accounts.

| Capability                                                                        | Guest | Student | Instructor (approved) |      Admin      |
| --------------------------------------------------------------------------------- | :---: | :-----: | :-------------------: | :-------------: |
| Browse catalog and syllabus (no media)                                            |  ✅   |   ✅    |          ✅           |       ✅        |
| Verify a certificate (public page)                                                |  ✅   |   ✅    |          ✅           |       ✅        |
| Enrol, pay, learn, comment, get a certificate                                     |  ❌   |   ✅    |          ❌           |       ❌        |
| Create / edit / publish **own** courses, batches, modules, content, announcements |  ❌   |   ❌    |  ✅ (needs approval)  | ✅ (any course) |
| Own analytics and students                                                        |  ❌   |   ❌    |       ✅ (own)        |    ✅ (all)     |
| Approve instructors, ban / deactivate users, change roles, anonymise users        |  ❌   |   ❌    |          ❌           |       ✅        |
| Payments overview, refunds, audit log                                             |  ❌   |   ❌    |          ❌           |       ✅        |

An instructor who registers starts as `pending`: they can sign in and prepare, but cannot create or publish a course
until an admin approves them. **Role decides which area you can enter; ownership decides which record you can touch.**
Both are enforced by the API.

## Quick start

### Option A: Docker (one command)

```bash
cp .env.example .env          # set JWT_SECRET (16+ random characters)
docker compose up --build     # app on http://localhost:8080, API on http://localhost:5000
```

The first start creates the schema and demo data (`SEED_DEMO_DATA=true`); later starts only apply pending migrations.
Uploads need Cloudinary keys and payments need Razorpay keys in `.env`; without them the rest of the app still runs.
This stack is a **demo**: the seed users share a known password, do not expose it to the internet as it is.

### Option B: run it yourself

```bash
# 1. PostgreSQL running, then a database
psql -U postgres -c "CREATE DATABASE elearning_db"

# 2. API
cd server
npm install
cp .env.example .env          # set DATABASE_URL and JWT_SECRET at least
node scripts/db.mjs setup --seed
npm run dev                   # http://localhost:5000  (GET /health)

# 3. Client (second terminal)
cd client
npm install
npm run dev                   # http://localhost:5173
```

### Setup full DB Command with psql shell

```bash
DROP DATABASE IF EXISTS elearning_db WITH (FORCE);
\i 'B:/example-path/E-learning/database/elearning_full_setup.sql'
```

### Seed logins

All use the password `Password123!`.

| Email                                             | Role                  |
| ------------------------------------------------- | --------------------- |
| admin@elearning.com                               | Admin                 |
| john.doe@elearning.com, sarah.smith@elearning.com | Instructor (approved) |
| alice@student.com, bob@student.com                | Student               |

## Configuration

Copy `server/.env.example` to `server/.env`. The server **refuses to start** without `DATABASE_URL` and a real `JWT_SECRET`.

| Variable                                                                                          | Default                          | Meaning                                                                                                              |
| ------------------------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                                    | –                                | `postgres://user:pass@host:5432/db` (the older `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_PORT` still work) |
| `JWT_SECRET`                                                                                      | –                                | 16+ characters, not `change-me`                                                                                      |
| `JWT_EXPIRES_IN`                                                                                  | `7d`                             | token lifetime                                                                                                       |
| `PORT`, `NODE_ENV`                                                                                | `5000`, `development`            |                                                                                                                      |
| `CLIENT_URL`                                                                                      | `http://localhost:5173`          | comma-separated allowed browser origins (CORS)                                                                       |
| `TRUST_PROXY`                                                                                     | off                              | set to `1` behind one reverse proxy so rate limits see the real IP                                                   |
| `DB_SSL`                                                                                          | `true` in production             | TLS to the database; `false` for a private network without TLS                                                       |
| `DB_SSL_REJECT_UNAUTHORIZED`                                                                      | `true`                           | `false` only for a provider with a self-signed certificate                                                           |
| `AUTH_RATE_LIMIT`                                                                                 | `20`                             | login / register attempts per IP per 15 minutes                                                                      |
| `API_RATE_LIMIT`                                                                                  | `600`                            | requests per IP per minute for every other `/api` route                                                              |
| `LOG_LEVEL`                                                                                       | `info`                           | `debug` `info` `warn` `error` `silent`                                                                               |
| `LOG_FORMAT`                                                                                      | text (JSON in production)        | `json` to force JSON lines                                                                                           |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`                            | –                                | media storage                                                                                                        |
| `CLOUDINARY_AUTH_TOKEN_KEY`, `MEDIA_URL_TTL_SECONDS`                                              | – / `3600`                       | with token authentication, signed media URLs also expire                                                             |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`                                                          | –                                | payments (create-order answers 503 without them)                                                                     |
| `RAZORPAY_WEBHOOK_SECRET`                                                                         | –                                | the webhook is rejected unless it is set                                                                             |
| `PENDING_ENROLLMENT_MINUTES`                                                                      | `30`                             | unpaid enrollments expire and free the seat                                                                          |
| `MAX_VIDEO_UPLOAD_MB`, `VIDEO_PART_SECONDS`, `VIDEO_MAX_HEIGHT`, `VIDEO_CRF`, `VIDEO_MAX_PART_MB` | `4096`, `600`, `480`, `30`, `95` | video processing (needs CPU and memory: ffmpeg re-encodes uploads)                                                   |
| `SEED_DEMO_DATA`                                                                                  | `false`                          | `db.mjs init` seeds demo data into an empty database                                                                 |
| `ALLOW_SEED_IN_PRODUCTION`                                                                        | unset                            | required to seed / reset with `NODE_ENV=production`                                                                  |
| `DB_DIR`                                                                                          | `../database`                    | where the runner finds the SQL files                                                                                 |
| `TEST_DATABASE_URL`                                                                               | local `elearning_test`           | disposable database for the tests (**wiped each run**)                                                               |

Client: `VITE_API_BASE_URL` (default `http://localhost:5000/api/v1`, baked in at build time). See [`client/README.md`](client/README.md).

## Tests and CI

```bash
# server: 120 integration tests (supertest + a real PostgreSQL; the database is wiped each run)
cd server && npm install
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/elearning_test npm test

# client: component tests (no server or database needed)
cd client && npm install && npm test
```

The test database name must contain `test`. GitHub Actions (`.github/workflows/ci.yml`) runs three jobs on every
push and pull request:

- **server**: PostgreSQL 16 service, `npm ci`, `npm run lint` (syntax check), `npm test`.
- **database**: `build-full-setup.mjs --check`, a fresh `setup --seed`, then `migrate` must say "Nothing to migrate".
- **client**: `npm ci`, lint, tests, production build.

## Database workflow

See [`database/README.md`](database/README.md) for the ER diagram, migrations 001-009, the certificate policy and
the runner commands. In short: change `schema.sql` / `functions.sql` **and** add `migrations/NNN_*.sql`, run
`node database/build-full-setup.mjs`, never edit `elearning_full_setup.sql` by hand.

```bash
cd server
node scripts/db.mjs status     # applied / PENDING migrations
node scripts/db.mjs migrate    # apply pending ones to an existing database
```

## API

Base path `/api/v1`. Every response has `success`; failures are `{ success: false, message }` (validation errors
also carry `errors: [{ path, message }]`). List endpoints marked ⇅ accept optional `?page=&limit=` (limit 1-100):
without them the full list comes back exactly as before, with them the response adds
`pagination: { page, limit, total, totalPages }`.

| Area                         | Endpoints                                                                                                                                                                                                                                                                                                            |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Health                       | `GET /health` (200 when the database answers, else 503; outside `/api/v1`)                                                                                                                                                                                                                                           |
| Auth                         | `POST /auth/register`, `POST /auth/login`, `GET /auth/me`                                                                                                                                                                                                                                                            |
| Courses (public)             | `GET /courses` ⇅, `GET /courses/:id` (media URLs only for the owner, admins and enrolled students)                                                                                                                                                                                                                   |
| Courses (instructor / admin) | `GET /courses/instructor/me`, `POST /courses`, `GET /courses/:id/manage`, `PATCH /courses/:id`, `PATCH /courses/:id/status`, `PATCH /courses/:id/publish`, `DELETE /courses/:id`                                                                                                                                     |
| Modules and content          | `GET/POST /courses/:id/modules`, `PUT .../modules/order`, `PATCH/DELETE .../modules/:moduleId`, `POST .../modules/:moduleId/content` (multipart), `DELETE .../content/:contentId`                                                                                                                                    |
| Batches                      | `GET/POST /courses/:id/batches`, `PATCH /courses/:id/batches/:batchId`                                                                                                                                                                                                                                               |
| Enrollments                  | `POST /enrollments` (student), `GET /enrollments/me` ⇅, `POST /enrollments/:id/drop`                                                                                                                                                                                                                                 |
| Payments                     | `POST /payments/create-order`, `POST /payments/verify`, `POST /payments/webhook` (Razorpay, signed)                                                                                                                                                                                                                  |
| Progress                     | `POST /progress`, `GET /progress/:enrollmentId`                                                                                                                                                                                                                                                                      |
| Certificates                 | `GET /certificates/my-certificates`, `GET /certificates/:id`, `GET /certificates/:id/pdf`, `GET /certificates/verify/:code` (public, rate limited)                                                                                                                                                                   |
| Discussion                   | `GET /modules/:id/comments` ⇅, `POST /modules/:id/comments`                                                                                                                                                                                                                                                          |
| Announcements                | `POST /courses/:id/announcements`                                                                                                                                                                                                                                                                                    |
| Notifications                | `GET /notifications` ⇅, `PUT /notifications/:id/read`                                                                                                                                                                                                                                                                |
| Analytics                    | `GET /analytics/overview` and `GET /analytics/timeline?months=12` (revenue net of refunds + enrollments per month) (instructor: own, admin: all)                                                                                                                                                                     |
| Admin (admin only)           | `GET /admin/overview`, `GET /admin/users`, `PATCH /admin/users/:id/status`, `.../role`, `.../instructor-status`, `DELETE /admin/users/:id` (anonymise), `GET /admin/courses`, `PATCH /admin/courses/:id/status`, `.../instructor`, `GET /admin/payments`, `POST /admin/payments/:id/refund`, `GET /admin/audit-logs` |

## Running in production: what to know

- Use a real `JWT_SECRET`, `NODE_ENV=production`, TLS to the database (the default), and never seed or reset production.
- Put the API behind one reverse proxy and set `TRUST_PROXY=1`. The client image's nginx already proxies `/api` and
  sets a Content-Security-Policy for Razorpay and Cloudinary (see `client/nginx.conf`).
- Video processing jobs run **in memory**: a restart marks in-flight videos as failed and the instructor has to
  upload again. Signed media URLs only _expire_ when `CLOUDINARY_AUTH_TOKEN_KEY` is configured.
- Refunds are admin-triggered, full-amount only, and not allowed once a certificate was issued.
- Secrets stay out of the repository: `.env` and `server/manifest.json` are git-ignored; rotate any key that was ever
  pasted into a chat or a zip.

## Project layout

```
client/            React SPA (+ Dockerfile, nginx.conf)
server/            Express API (+ Dockerfile, docker-entrypoint.sh)
  src/             routes, controllers, repositories, services, validation, middleware
  scripts/         db.mjs (setup / migrate / status), content seeding and maintenance scripts
  tests/           vitest + supertest integration tests
database/          schema, functions, triggers, views, seeds, migrations, generated full setup
docker-compose.yml db + server + client
.github/workflows/ci.yml
```
