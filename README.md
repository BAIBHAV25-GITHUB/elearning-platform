# E-Learning Platform

Three folders: `elearning-database` (PostgreSQL), `elearning-server` (Express 5), `elearning-client` (React 19 + Vite).

## Setup order
1. **Database** (PostgreSQL 14+): follow `elearning-database/README.md` (`00_create_db.sql`, then `schema`, `functions`, `triggers`, `views`, `seed/base_seed`).
2. **Server**: `cd elearning-server && cp .env.example .env`, then set
   - `DATABASE_URL` (e.g. `postgres://postgres:postgres@localhost:5432/elearning_db`)
   - `JWT_SECRET`: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` (the server refuses to start with the placeholder)
   - Cloudinary keys (video/PDF uploads) and Razorpay keys + `RAZORPAY_WEBHOOK_SECRET` (payments; the webhook is rejected without the secret)
   - `npm install && npm run dev` (port 5000)
3. **Client**: `cd elearning-client && cp .env.example .env` (`VITE_API_BASE_URL=http://localhost:5000/api/v1`), `npm install && npm run dev` (port 5173).

## Seed logins (password `Password123!`)
| Email | Role |
|---|---|
| admin@elearning.com | Admin |
| john.doe@elearning.com, sarah.smith@elearning.com | Instructor |
| alice@student.com, bob@student.com | Student |

## Razorpay
Create test keys in the Razorpay dashboard. Point a webhook at `POST /api/v1/payments/webhook` (events `payment.captured`, `order.paid`) and use the same secret as `RAZORPAY_WEBHOOK_SECRET`. Locally, expose the server with a tunnel.

## Loading existing videos
`elearning-server/scripts/seed-content.mjs` loads a Cloudinary `manifest.json` into a course you created in the app (see the comment at the top of the file).

## Smoke test
With the server running on a freshly seeded DB: `cd elearning-server && bash scripts/smoke-test.sh` prints each check with its HTTP status.
