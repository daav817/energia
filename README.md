# Energia Power LLC - CRM & Brokerage Management

Proprietary containerized CRM and Brokerage Management web application for Energia Power LLC. Built with Next.js, PostgreSQL, Prisma, Tailwind CSS, and Shadcn UI.

## Quick Start

### Prerequisites

- Docker & Docker Compose
- Node.js 20+ (for local development without Docker)

### Run with Docker

```bash
# Start PostgreSQL and the app
docker compose up -d

# App runs at http://localhost:3001
# Database runs at localhost:5433
```

**If the app doesn't load**, check the container logs: `docker compose logs app`. The first run may take a few minutes (npm install). Ensure port 3001 is free.

### Portable mode (move to another laptop)

```bash
# Copy the project folder to the new laptop, then:
docker compose -f docker-compose.yml -f docker-compose.portable.yml up -d
```

Portable mode runs from the built image (no host mounts). Gmail tokens are stored in a Docker volume.

### Production-style run (Dockerfile.prod + docker-compose.prod.yml)

```bash
# 1) Build the production image and start app + postgres in background
docker compose -f docker-compose.prod.yml up --build -d

# 2) Follow app logs live (startup, migrations, runtime errors)
docker compose -f docker-compose.prod.yml logs -f app

# 3) Follow database logs live (health, auth, connection issues)
docker compose -f docker-compose.prod.yml logs -f postgres

# 4) Check running services and health status
docker compose -f docker-compose.prod.yml ps

# 5) Stop and remove containers (keeps named volumes, so DB data persists)
docker compose -f docker-compose.prod.yml down

# 6) Stop and remove containers + volumes (DANGER: deletes postgres data)
docker compose -f docker-compose.prod.yml down -v
```

Notes:
- App is exposed on `http://localhost:${APP_PORT}` (defaults to `http://localhost:3001`).
- Postgres is exposed on `localhost:${POSTGRES_PORT}` (defaults to `5433`).
- You can override defaults with env vars (`APP_PORT`, `POSTGRES_PORT`, `DATABASE_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`).

### Local development (no Docker for app)

```bash
# Start only PostgreSQL
docker compose up postgres -d

# Run app locally
npm install
npm run dev
```

The app will:

1. Start PostgreSQL
2. Run Prisma migrations (or `db push` on first run)
3. Start the Next.js dev server with hot reload

**If tables are not created automatically**, run the database setup:

```powershell
# Windows (PowerShell)
.\scripts\setup-db.ps1

# Or via npm
npm run db:setup:docker
```

### Local Development (without Docker)

```bash
# Create virtual environment (optional - Node uses node_modules)
# For Python scripts if added later: python -m venv .venv

# Install dependencies
npm install

# Start PostgreSQL via Docker (database only)
docker compose up postgres -d

# Copy env and set DATABASE_URL for localhost
cp .env.example .env

# Generate Prisma client and push schema
npx prisma generate
npx prisma db push

# Run dev server
npm run dev
```

## Project Structure

```
├── app/                 # Next.js App Router
│   ├── api/             # API routes
│   ├── layout.tsx
│   └── page.tsx
├── lib/                 # Utilities
│   ├── prisma.ts        # Prisma client
│   └── license.ts       # License expiration (2-year calc)
├── prisma/
│   ├── schema.prisma    # Database schema
│   └── migrations/
├── docker-compose.yml
├── Dockerfile
└── .env.example
```

## Database Schema Overview

| Entity | Purpose |
|--------|---------|
| **Customer** | CRM data, `has_electric`, `has_natural_gas` |
| **Supplier** | Supplier details, `is_electric`, `is_natural_gas` |
| **Contract** | Links customer/supplier, pricing, dates, income |
| **CommissionPayment** | Monthly commission from supplier (email/portal) |
| **Task** | Todos/notes tied to Customer or Prospect |
| **Prospect** | Unconverted leads |
| **Document** | Metadata + Google Drive URLs |
| **License** | CRNGS/CRES, auto 2-year expiration from issue |
| **RfpRequest/RfpQuote** | RFP workflow |
| **Email** | Communication hub |

## License Expiration

When creating a license via `POST /api/licenses`, the `expirationDate` is automatically set to **2 years** from `issueDate`. Use the `calculateLicenseExpiration()` helper in `lib/license.ts` for any custom flows.

## Environment Variables

See `.env.example` for all variables. Key ones:

- `DATABASE_URL` - PostgreSQL connection string
- `GOOGLE_*` - Gmail, Drive, Contacts (for Modules 2–3)
- `EIA_API_KEY`, `NEWS_API_KEY` - Market data (Module 5)

## Module 1: Directory (Complete)

- **Customers** – Full CRUD at `/directory/customers`. Filter by Electric, Natural Gas, or Both. Search by name, email, company.
- **Suppliers** – Full CRUD at `/directory/suppliers`. Filter by Electric, Natural Gas, or Both. Search by name or email.

## Module 2: Communication Hub (Complete)

- **Gmail** – OAuth connect, send/receive emails at `/communications`
- **Inbox** – List recent emails, sync to DB (links to customers/suppliers)
- **Compose** – Send emails at `/communications/compose`
- **RFP Generator** – Select customer + energy type, blast RFP to all matching suppliers at `/communications/rfp`
- **Margin Calculator** – Total brokerage margin over contract life
- **Rate Comparison** – Compare current vs new rate, annual savings
- **RFP Quotes** – Add quotes, mark best offer, pricing table at `/communications/quotes`

See `docs/MODULE2-SETUP.md` for Google OAuth setup.

## Next Steps (Modules)

2. **Communication Hub** - Gmail integration, RFP generator
3. **Document Automation** - Google Drive webhooks
4. **Calendar & Reminders** - Expiration dashboard (30/60/90 days)
5. **Market Research** - EIA + NewsAPI integration
