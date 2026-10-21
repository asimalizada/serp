# SERP

SERP is a multi-tenant SEO workspace for client websites. It discovers blog articles, records historical page analysis and SEO issues, and shows keyword rank history. Demo rankings are **synthetic**, not Google positions. The pnpm/TypeScript monorepo contains a NestJS 11 API (`apps/api`), Next.js 16 frontend (`apps/web`), shared Zod schemas (`packages/shared`), Prisma 7, and PostgreSQL 17.

## Quick start

Prerequisites: Node.js 22.12+, pnpm 10.33.2, Docker Compose v2, and internet access for demo crawls. From the repository root:

```sh
pnpm install --frozen-lockfile
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
```

In the ignored root `.env`, set a unique `JWT_SECRET` (at least 32 characters), development-only `SEED_USER_A_PASSWORD` and `SEED_USER_B_PASSWORD` (each 12–72 UTF-8 bytes), and a new `POSTGRES_PASSWORD`. Make `DATABASE_URL` match the PostgreSQL user, password, database, and `POSTGRES_PORT`; URL-encode special password characters. The examples use API port 3001 and web port 3000: keep `API_ORIGIN` and the web `NEXT_PUBLIC_API_ORIGIN` aligned, and set `WEB_ORIGIN` to the browser origin. Other example settings can retain their development defaults.

```sh
pnpm --filter @serp/shared build
docker compose up -d --wait
pnpm db:migrate:deploy
pnpm db:generate
pnpm seed
pnpm dev
```

Open [Sign in](http://localhost:3000/login). Seeding fetches public sites, so availability affects crawl results. For checks, run `pnpm db:validate`, `pnpm --filter @serp/api test`, `pnpm --filter @serp/web test`, and `pnpm build`. API tests create a separate temporary database and require database-creation permission.

## Demo accounts

| Email | Password variable |
| --- | --- |
| `semrush.demo@serp.local` | `SEED_USER_A_PASSWORD` |
| `yoast.demo@serp.local` | `SEED_USER_B_PASSWORD` |

Use the passwords you set in `.env`; no credentials are committed.

## Engineering decisions

- NestJS keeps API, crawler, and worker responsibilities separate; Next.js provides responsive application screens. pnpm workspaces keep both apps and shared contracts in one repository.
- PostgreSQL and Prisma migrations preserve crawl history and enforce tenant relationships. Recrawls add analyses rather than overwrite them.
- Shared Zod schemas keep request validation consistent across browser and API. HttpOnly access and rotating refresh cookies support persistent sign-in without JavaScript-readable tokens.
- Client creation queues crawling so the API responds promptly; the same crawler serves seeding and new clients.

## Trade-offs and next steps

Rank snapshots simulate daily positions; they do not query Google. Sitemap heuristics and third-party availability can produce fewer than 15 articles. Pending crawls resume after restart, but interrupted **running** jobs need manual review. Production work would add job leasing/recovery and verify deployment cookie, origin, and HTTPS configuration.

## AI assistance

ChatGPT supported planning, requirement analysis, architecture/design discussions, and prompt preparation. OpenAI Codex assisted with implementation and testing. Claude provided independent code and architecture review. AI-assisted changes were reviewed and tested before acceptance.