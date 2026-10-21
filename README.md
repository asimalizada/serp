# SERP

SERP is an SEO workspace for client websites. It discovers blog articles through sitemaps, records page analysis and SEO issues across crawls, and displays keyword rank history. Demo rank positions are **synthetic**, not Google Search results. Each user's clients and data are isolated by the API.

## Stack and structure

- `apps/api`: NestJS 11 REST API, crawler, background worker, seed command, and Prisma 7 migrations.
- `apps/web`: Next.js 16 App Router, React 19, Tailwind CSS 4, and IBM Plex fonts.
- `packages/shared`: Zod input and query schemas shared by API and frontend.
- PostgreSQL 17 via Docker Compose; TypeScript and pnpm 10 throughout.

The backend separates auth, clients, pages, users, crawler, database, and seed responsibilities. The frontend uses a small browser API client and shared schemas.

## Features

- Email/password sign in, JWT access and rotating refresh cookies, logout, and PostgreSQL-backed login throttling.
- Client creation with asynchronous crawling and crawl status.
- Tenant-scoped Pages search, client filtering, and server-side pagination.
- Historical page crawls, keyword relevance, six SEO issue types, and rank history with date filters.
- IANA timezone preference for local rank-history dates; snapshots remain stored in UTC.

## Local setup

Prerequisites: Node.js **22.12+**, **pnpm 10.33.2**, Docker Compose, and network access for demo crawls. From the repository root:

```sh
pnpm install --frozen-lockfile
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
```

Edit the ignored root `.env`. Set a unique `JWT_SECRET` of at least 32 characters and distinct development-only `SEED_USER_A_PASSWORD` and `SEED_USER_B_PASSWORD` values of 12–72 UTF-8 bytes. Change the example PostgreSQL password and update `DATABASE_URL` to match; URL-encode special characters in the URL password. If port 5432 is occupied, set `POSTGRES_PORT` and the same port in `DATABASE_URL`. The web app's `NEXT_PUBLIC_API_ORIGIN` must match `API_ORIGIN`; `WEB_ORIGIN` must match the browser origin. The examples use ports 3001 and 3000.

```sh
pnpm --filter @serp/shared build
docker compose up -d
pnpm db:migrate:deploy
pnpm db:generate
pnpm seed
pnpm dev
```

Open `http://localhost:3000/login`. The API listens at `http://localhost:3001`. Seeding fetches public websites and may take time. Inspect its crawl summaries if a site is unavailable. Rerunning it recovers missing successful demo pages and rank dates without deleting historical records.

Use `pnpm dev:api` or `pnpm dev:web` to run one app. For production builds, run `pnpm build`, then `pnpm start:api` and `pnpm start:web` in separate terminals with PostgreSQL and the configured environment available.

### Demo accounts

| Email | Password environment variable | Website |
| --- | --- | --- |
| `semrush.demo@serp.local` | `SEED_USER_A_PASSWORD` | `https://www.semrush.com` |
| `yoast.demo@serp.local` | `SEED_USER_B_PASSWORD` | `https://yoast.com` |

Use the passwords supplied in your ignored `.env`. The seed stores bcrypt hashes and never replaces an existing demo user's password. There is no public registration endpoint.

## Checks and commands

```sh
pnpm db:validate
pnpm --filter @serp/shared build
pnpm --filter @serp/api test
pnpm --filter @serp/web typecheck
pnpm --filter @serp/web lint
pnpm --filter @serp/web test
pnpm build
```

The API test command builds the API. Its database integration tests create and remove a **separate, uniquely named test database**; the configured PostgreSQL user needs database creation permission. An optional live HTTP test is skipped unless `SERP_TEST_API_ORIGIN` and both demo password variables are set. That optional test creates an `example.org` client and briefly updates a demo timezone, so use a disposable seeded database for it.

Other scripts: `pnpm db:migrate:dev` creates development migrations; `pnpm db:migrate:deploy` applies committed migrations; `pnpm db:generate` regenerates Prisma Client; `pnpm crawl --client <uuid>` crawls an existing client. Crawling does **not** generate rank snapshots.

## API overview

Browser requests use `credentials: 'include'`; mutating browser requests require an allowed `Origin` header. All client, page, crawl, keyword, and rank queries enforce ownership. Inaccessible IDs return 404. Error responses use `{ statusCode, error, message }`.

| Endpoint | Purpose |
| --- | --- |
| `POST /auth/login` | Validate credentials, set access and refresh cookies, return user. |
| `POST /auth/refresh` | Rotate refresh token and replace both cookies. |
| `POST /auth/logout` | Revoke refresh token and clear cookies. |
| `GET /auth/me` | Return `{ user: { id, email, timezone } }`. |
| `GET /clients` | List owned clients and crawl summaries. |
| `POST /clients` | Validate website and return HTTP 202 with client and pending crawl run. |
| `GET /clients/:id/crawl-status` | Return latest crawl status and counts. |
| `GET /pages` | Paginated pages; `clientId`, `url`, `keyword`, `search`, `page`, `pageSize` (default 20, max 100). |
| `GET /pages/:id` | Latest successful page analysis, keywords, ranks, and issues. |
| `GET /pages/:id/rank-history` | History using `keywordId?` (page-keyword ID), `from?`, `to?` in `YYYY-MM-DD` form. |
| `PATCH /users/me/timezone` | Save an IANA timezone and refresh the access cookie. |

Without `keywordId`, rank history uses the primary keyword from the latest successful crawl. The default range is 30 local calendar days, with a maximum inclusive span of 366 days. Missing ranks are `null`.

## Data and lifecycle

The 11 SEO tables are `Users`, `Clients`, `CrawlRuns`, `Pages`, `PageCrawls`, `Keywords`, `PageKeywords`, `PageCrawlKeywords`, `SeoIssueTypes`, `SeoIssues`, and `RankSnapshots`. Two authentication tables, `RefreshTokens` and `AuthThrottles`, support rotation and shared login limits. Prisma migrations include PostgreSQL constraints and triggers for cross-client relationships, status values, UTC snapshot dates, and historical immutability. Recrawls create new runs and page analyses; prior records and rank snapshots remain intact.

The API worker polls pending runs and processes pages with bounded concurrency. It resumes **pending** runs after restart. A run already marked running is left for operator review because ownership cannot be inferred after a crash. Run one API worker for the queue until distributed claiming or leasing is added.

Access JWTs last 15 minutes. Opaque refresh tokens last seven days and are stored hashed in PostgreSQL; rotation is atomic. Both cookies are HttpOnly, SameSite=Lax, and Secure in production. Logout revokes the refresh token. PostgreSQL-backed `@nestjs/throttler` limits login to 20 requests per IP and five per normalized email per 15 minutes. Limits count requests, including successful ones. For deployment, use compatible same-site HTTPS origins, set `WEB_ORIGIN` and `API_ORIGIN` exactly, and set `TRUST_PROXY_HOPS` to the number of trusted reverse proxies (default 0).

## Trade-offs and limitations

- Seeded rank history is deterministic simulated daily movement, generated in batches for every PageKeyword. It targets at least 50,000 rows and at least 365 days, extending the range when needed. It does not query Google or estimate real search performance. Existing snapshots are never overwritten; new page-keyword relationships receive snapshots only when the seed runs again.
- Blog discovery uses robots.txt, conventional sitemap locations, nested XML/gzip sitemaps, and general article URL heuristics. It selects at most 15 qualifying URLs in sitemap order. Inaccessible or malformed sitemaps, blocked fetches, or unusual URL structures may yield fewer pages. Individual page failures are recorded without discarding successful pages.
- Fetches use public-IP checks for initial and redirect destinations, timeouts, redirect and response-size limits, and three concurrent page requests. The crawler stores extracted metadata and a SHA-256 content hash, not raw HTML.
- The in-process crawl queue has no cross-instance lease or automatic recovery of abandoned **running** jobs. Production use needs an operator recovery procedure and shared worker coordination.
- Browser auth requires compatible cookie, CORS, Origin, and HTTPS configuration. The optional live HTTP integration test and live external-site crawls depend on credentials, services, and third-party availability; routine tests do not exercise those paths automatically.
