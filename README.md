# SERP

Minimal pnpm workspace for an SEO keyword tracking platform. Requires Node.js 22.12+, pnpm 10, and Docker Compose for local PostgreSQL.

## Local setup

1. Copy `.env.example` to `.env`, choose a password, and update `DATABASE_URL` to match. If the password has URL-special characters, URL-encode it in `DATABASE_URL`.
2. Run `pnpm install`.
3. Run `docker compose up -d` to start PostgreSQL.
4. Run `pnpm db:migrate:deploy` and `pnpm db:generate`.
5. Run `pnpm dev` to start the API on port 3001 and the web app on port 3000.

The API root route returns a starter response. API startup validates `DATABASE_URL`, `API_PORT`, `WEB_ORIGIN`, `API_ORIGIN`, `NODE_ENV`, and `TRUST_PROXY_HOPS`.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start both apps in watch mode |
| `pnpm dev:api` / `pnpm dev:web` | Start one app |
| `pnpm build` | Build shared, API, and web packages |
| `pnpm start:api` / `pnpm start:web` | Run production builds |
| `pnpm db:validate` | Validate the Prisma schema |
| `pnpm db:generate` | Generate Prisma Client from the schema |
| `pnpm db:migrate:dev` | Create and apply migrations in development |
| `pnpm db:migrate:deploy` | Apply committed migrations in deployment |
| `pnpm crawl --client <uuid>` | Build the API and crawl an existing client |
| `pnpm seed` | Provision two demo clients, recover incomplete crawls, and generate daily synthetic ranks |
| `pnpm --filter @serp/api test` | Build and run backend tests |

`apps/api` loads the root `.env` for Prisma commands and API startup. If port 5432 is occupied, set `POSTGRES_PORT` in `.env` and use the same port in `DATABASE_URL`.

## REST API

Set `WEB_ORIGIN` and `API_ORIGIN` for the allowed browser origins (defaults: `http://localhost:3000` and `http://localhost:3001`). Browser requests must use credentials. Login sets an opaque, HTTP-only, SameSite=Lax cookie, with `Secure` enabled in production. The session is stored in PostgreSQL for eight hours; logout deletes the session, including across API restarts. Deploy the frontend and API on the same site for SameSite=Lax cookie delivery. Mutating browser requests require an allowed `Origin` header. The API trusts no proxy headers by default; set `TRUST_PROXY_HOPS` to the exact number of trusted reverse proxies when deployed behind one. This controls the IP used for throttling.

Only `POST /auth/login` is throttled. Nest's `@nestjs/throttler` uses PostgreSQL storage, with limits of 20 requests per IP and 5 requests per normalized email over 15 minutes. These are **request counts**, whereas the previous in-memory limiter counted **failed logins** and cleared the account count after success. Successful logins now consume the same budget, and the limit persists across restarts and API instances. Expired sessions and throttle rows are removed at API startup and hourly. The account limit can temporarily lock out a targeted account; the IP limit reduces casual abuse, but no CAPTCHA or external abuse service is included.

| Endpoint | Request | Response |
| --- | --- | --- |
| `POST /auth/login` | `{ email, password }` | `{ user: { id, email, timezone } }` and session cookie |
| `POST /auth/logout` | Session cookie | `{ success: true }` and cleared cookie |
| `GET /auth/me` | Session cookie | `{ user: { id, email, timezone } }` |
| `GET /clients` | Session cookie | `{ clients: [{ id, name, websiteUrl, normalizedDomain, createdAt, pageCount, latestCrawl }] }` |
| `POST /clients` | `{ websiteUrl, name? }` | HTTP 202, `{ client, crawlRun: { id, status: 0 } }` |
| `GET /clients/:id/crawl-status` | Session cookie | `{ clientId, crawlRun }`; counts and status on the latest run |
| `GET /pages` | `clientId?`, `url?`, `keyword?`, `search?`, `page?`, `pageSize?` | `{ items, pagination }`; at most 100 pages per response |
| `GET /pages/:id` | Session cookie | Current successful analysis, issues, keywords and latest ranks |
| `GET /pages/:id/rank-history` | `keywordId?`, `from?`, `to?` | `{ pageId, pageKeywordId, keyword, timezone, from, to, history, latestPosition }` |
| `PATCH /users/me/timezone` | `{ timezone }` | `{ user: { id, email, timezone } }` |

`keywordId` on rank history is the page-keyword relationship ID returned as `pageKeywordId` in page keywords. Without it, the endpoint uses the current primary keyword: the highest relevance score in the latest successful PageCrawl, with phrase as the tie breaker. `latestRank` is null when no snapshot exists. Rank-history dates are interpreted in the user's IANA timezone, while stored `snapshotAt` remains UTC. The default range is the last 30 local calendar days; the maximum is 366 days. Every resource query checks the authenticated owner's user ID. Inaccessible client, page, and keyword IDs return 404.

Adding a client validates its public destination and creates a pending CrawlRun before returning. The in-process worker handles the crawl and never generates rank snapshots. Pending runs resume on restart. A Running run is left untouched because status alone cannot prove that its worker stopped; an operator must inspect and recover a genuinely abandoned run. Only one API worker should process the queue until a shared claim/lease strategy is added. Error responses use `{ statusCode, error, message }`.

## Demo seed

Set `SEED_USER_A_PASSWORD` and `SEED_USER_B_PASSWORD` in your ignored `.env` to distinct development-only passwords of 12 to 72 UTF-8 bytes, then run `pnpm seed`. The demo login emails are `semrush.demo@serp.local` and `yoast.demo@serp.local`; use the passwords you supplied. The seed stores bcrypt hashes and does not change an existing demo user's password.

The seed creates or reuses one client per demo user (`https://www.semrush.com` and `https://yoast.com`) and crawls the first 15 qualifying blog posts in sitemap order. A complete prior crawl is skipped. If a crawl is partial, only URLs without a prior successful PageCrawl are retried in a new CrawlRun; old results remain untouched. Failed fetches are recorded, and a failed crawl may be retried by running the seed again.

Rank generation is a separate operation within the seed. It covers every existing PageKeyword, including relationships added through later crawls, and creates at least 50,000 synthetic daily observations overall. The date range expands when there are fewer relationships, with a minimum of 365 days. Positions are deterministic and change gradually. Existing snapshots are left intact, and only missing dates are inserted in batches. `pnpm crawl` never generates rank snapshots.

## Database schema

The initial Prisma migration creates the 11 application tables. The additive authentication migration creates `AuthSessions` and `AuthThrottles`; it does not alter the historical data model. `PageCrawls.clientId` and `PageCrawlKeywords.pageId` let PostgreSQL enforce that a crawl uses a page from its client and that historical relevance refers to a persistent page-keyword identity. Historical foreign keys restrict deletion and key updates, preserving history across recrawls.

Crawl and page-crawl statuses use `0 = pending`, `1 = running/processing`, `2 = completed`, and `3 = failed`. Issue severity uses `1 = Info`, `2 = Warning`, and `3 = Critical`. The migrations enforce these values, relevance and ranking bounds, and the UTC date of each rank snapshot. `snapshotAt` must be supplied explicitly. Completed or failed crawl runs and page crawls and their historical details, plus rank snapshots, cannot be edited or deleted. Write page-crawl keywords and issues before marking a page crawl completed or failed. Normalize incoming emails with `normalizeEmail` before user creation or lookup; PostgreSQL also normalizes stored emails and enforces case-insensitive uniqueness.

## Website crawler

`pnpm crawl --client <uuid>` runs the crawler for a Client already in PostgreSQL. It reads the client's `websiteUrl`, discovers robots.txt and conventional sitemaps, traverses nested XML and gzip sitemaps in listed order, and selects up to 15 likely blog articles. The URL rules use general blog, article, news, guide, dated-path, and blog-subdomain patterns; they do not contain site-specific paths.

The crawler uses three concurrent page requests, a 12-second total request timeout, a 2 MB response limit, a 5-redirect limit, and public-IP checks for each destination. It extracts article text without navigation and computes a SHA-256 hash of normalized analyzed content. Keyword phrases use title, H1, headings, meta-description, and body-frequency signals; scores are rounded to four decimal places. Six initial SEO issue definitions are inserted into `SeoIssueTypes` on the first crawl.

Each crawl gets a new `CrawlRun`. Each selected URL gets a new `PageCrawl`; successful page details, keywords, and issues are saved in one database transaction before that page crawl becomes terminal. A failed page gets its own failed snapshot while other pages continue. Existing Pages, PageKeywords, previous PageCrawls, and RankSnapshots are retained. A run becomes terminal only after all selected pages have been recorded.