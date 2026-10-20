# SERP

Minimal pnpm workspace for an SEO keyword tracking platform. Requires Node.js 22.12+, pnpm 10, and Docker Compose for local PostgreSQL.

## Local setup

1. Copy `.env.example` to `.env`, choose a password, and update `DATABASE_URL` to match. If the password has URL-special characters, URL-encode it in `DATABASE_URL`.
2. Run `pnpm install`.
3. Run `docker compose up -d` to start PostgreSQL.
4. Run `pnpm dev` to start the API on port 3001 and the web app on port 3000.

The API root route returns a starter response. No database tables or migrations exist yet.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start both apps in watch mode |
| `pnpm dev:api` / `pnpm dev:web` | Start one app |
| `pnpm build` | Build shared, API, and web packages |
| `pnpm start:api` / `pnpm start:web` | Run production builds |
| `pnpm db:validate` | Validate the Prisma schema |
| `pnpm db:generate` | Generate Prisma Client when models are added |

`apps/api` loads the root `.env` for Prisma commands. The API does not connect to PostgreSQL on startup yet.
