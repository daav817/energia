# Energia — CRM & energy brokerage web application

**Audience:** This document is written for engineers who want to **run the system locally**: client-side UI/UX, APIs, persistence, and integrations.

**What this repo is:** A **Next.js** application for managing **customers, suppliers, contracts, commissions, tasks, communications (Gmail), scheduling, RFP/quote workflows, and related energy-brokerage data**. The stack is intentionally mainstream for maintainable full-stack TypeScript work.

---

## Architecture (how to read the codebase)

| Layer | Role | Where to look |
|--------|------|----------------|
| **Frontend** | App Router pages, layouts, client components for interactive flows (forms, dashboards, resizable panels, rich email compose) | `app/` (notably `app/(workspace)/`, `app/directory/`, `app/dashboard/`, `app/schedule/`) |
| **Backend** | REST-style **Route Handlers** (`GET`/`POST`/`PATCH`/`DELETE`) colocated with the app | `app/api/**/route.ts` |
| **Data** | **PostgreSQL** accessed through **Prisma** (schema, migrations, typed client) | `prisma/schema.prisma`, `prisma/migrations/`, `lib/prisma.ts` |
| **Integrations** | Google (Gmail, Drive, Contacts, Calendar, Tasks) via OAuth and APIs; optional market/news APIs | Env vars in `.env.example`; setup detail in `docs/MODULE2-SETUP.md` |

**Frontend signals:** React 18, Tailwind CSS, Radix UI primitives, composable UI under `components/`, TypeScript throughout.

**Backend signals:** Server-side route handlers, Prisma queries and transactions, JSON request/response contracts, OAuth callback routes, background-friendly patterns where applicable.

---

## Prerequisites

- **Node.js** 20+ (repo uses a current Next.js 16 / TypeScript toolchain; Node 22 is fine).
- **npm** (comes with Node).
- **Docker Desktop** (or compatible engine) if you want PostgreSQL — or the full app — in containers.

---

## Install and run (local development)

### 1. Clone and install JavaScript dependencies

```bash
git clone <repository-url>
cd energia-app
npm install
```

`postinstall` runs **`prisma generate`** so the Prisma client matches `prisma/schema.prisma`.

### 2. Environment file

```bash
cp .env.example .env
```

Edit **`.env`**. The most important variable for running the app is **`DATABASE_URL`**.

- This repo’s **Docker Compose** publishes PostgreSQL on the host as **`localhost:5433`** (mapped from `5432` inside the container). The example file matches that:

  `postgresql://energia:energia_dev_password@localhost:5433/energia_db`

- If you use your own Postgres on the default port, use **`localhost:5432`** and adjust user/password/database to match.

### 3. Database: start Postgres, then apply schema

**Recommended for evaluators:** run **only PostgreSQL** in Docker and run the **Next.js app on the host** (fast feedback, easy debugging).

```bash
# Start Postgres (defined in docker-compose.yml)
docker compose up postgres -d
```

Wait until the DB is healthy (Compose includes a healthcheck). Then apply migrations:

```bash
npx prisma migrate deploy
```

This applies everything under `prisma/migrations/`.  
For a throwaway local DB you may instead use `npm run db:push` (Prisma **db push** — syncs schema without migration history; fine for quick experiments, not for production workflow).

Optional: open Prisma Studio to inspect data:

```bash
npm run db:studio
```

On **Windows**, `scripts/setup-db.ps1` (and `scripts/setup-db.sh` on Unix) can help automate local DB steps if you use them in your environment.

### 4. Start the development server

```bash
npm run dev
```

The app listens on **port 3001** (see `package.json`: `next dev -p 3001`). Open **http://localhost:3001**.

`predev` attempts to free port 3001 if something else is bound (see `package.json`).

---

## Run everything with Docker (app + database)

For a single command that brings up **Postgres + Next.js dev server** inside containers:

```bash
docker compose up -d
```

- **App:** http://localhost:3001  
- **Postgres (host):** `localhost:5433` (user/password/db match `docker-compose.yml` and `.env.example`)

The app container runs install, `prisma generate`, then **`migrate deploy` or `db push`**, then `npm run dev`. If something fails, check **`docker compose logs app`**.

**Portable / alternate Compose files** (e.g. `docker-compose.portable.yml`, production variants) exist in the repo for different deployment shapes; the default `docker-compose.yml` is the usual development path.

---

## Useful npm scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Next.js dev server (port **3001**) |
| `npm run build` / `npm start` | Production build and start |
| `npm run lint` | ESLint (Next.js config) |
| `npm run db:generate` | `prisma generate` |
| `npm run db:migrate` | `prisma migrate dev` (creates migrations in dev) |
| `npm run db:migrate:deploy` | `prisma migrate deploy` (CI/prod-style apply) |
| `npm run db:push` | `prisma db push` (schema sync without new migration files) |
| `npm run db:studio` | Prisma Studio GUI |
| `npm run db:setup:docker` | Helper to run Prisma against Postgres **inside** Docker network (see `package.json`) |

---

## Project layout (abbreviated)

```
app/
  api/                 # Backend: Route Handlers (REST-style endpoints)
  (workspace)/         # Grouped app routes (e.g. quotes, RFP, inbox, compose)
  directory/           # Customers, suppliers, contracts (directory UI)
  dashboard/           # Dashboard
  schedule/            # Calendar / schedule
  ...
components/            # Reusable UI and feature components
lib/                   # Shared logic (Prisma helpers, domain rules, integrations)
prisma/
  schema.prisma        # Data model
  migrations/          # SQL migrations (source of truth for schema evolution)
docs/                  # Deeper setup (e.g. Google OAuth)
```

---

## Environment variables

See **`.env.example`** for the full list and comments. In practice:

- **`DATABASE_URL`** — required for any run that touches the DB.
- **`GOOGLE_*`** — Gmail, Drive, Contacts, Calendar, Tasks; app features are gated until OAuth is configured.
- **`NEXT_PUBLIC_APP_URL`** — base URL for redirects (default `http://localhost:3001`).
- **`EIA_API_KEY`**, **`NEWS_API_KEY`** — optional market/news features.

Google OAuth walkthrough: **`docs/MODULE2-SETUP.md`**. Scope reference: **`docs/GOOGLE-OAUTH-SCOPES.md`**.

---

## Database model (high level)

The Prisma schema is the authoritative description. At a glance, entities include **Customer**, **Supplier**, **Contact**, **Contract**, **RfpRequest** / **RfpQuote**, **Email**, **Task**, **CalendarEvent**, **License**, **Commission**-related structures, and **contract workflow** rows for pipeline tracking — aligned with a **B2B energy brokerage CRM** rather than a generic contact manager.

---

## Optional seed data

See comments in `.env.example` and the script **`scripts/seed-quotes-demo.ts`**. Example:

```bash
npm run db:seed:quotes-demo
```

---

## License and confidentiality

This software is **proprietary** to **Energia Power LLC**. Treat repository contents and customer data accordingly.

---

## Troubleshooting

| Issue | What to try |
|--------|-------------|
| Port **3001** in use | Stop the other process or change the dev port in `package.json` consistently. |
| DB connection refused | Ensure Postgres is up (`docker compose ps`), and **`DATABASE_URL` host/port** match (Compose uses **5433** on the host). |
| Prisma client out of date | Run `npm run db:generate` after pulling schema changes. |
| Migrations fail on fresh DB | Use `npx prisma migrate deploy` from a clean database; avoid mixing `db push` and migrate workflows on the same DB in production. |

For **Google** connectivity issues, start with **`docs/MODULE2-SETUP.md`** and verify redirect URIs match your local URL and Google Cloud console settings.
