# SERP

Minimal pnpm workspace for an SEO keyword tracking platform. Requires Node.js 22.12+, pnpm 10, and Docker Compose for local PostgreSQL.

## Local setup

1. Copy `.env.example` to `.env`, choose a password, and update `DATABASE_URL` to match. If the password has URL-special characters, URL-encode it in `DATABASE_URL`.
2. Run `pnpm install`.
3. Run `docker compose up -d` to start PostgreSQL.
4. Run `pnpm db:migrate:deploy` and `pnpm db:generate`.
5. Run `pnpm dev` to start the API on port 3001 and the web app on port 3000.

The API root route returns a starter response; database access is not wired into the application yet.

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
| `pnpm --filter @serp/api test` | Build and run crawler tests |

`apps/api` loads the root `.env` for Prisma commands. The API does not connect to PostgreSQL on startup yet. If port 5432 is occupied, set `POSTGRES_PORT` in `.env` and use the same port in `DATABASE_URL`.

## Database schema

The initial Prisma migration creates the 11 application tables. `PageCrawls.clientId` and `PageCrawlKeywords.pageId` let PostgreSQL enforce that a crawl uses a page from its client and that historical relevance refers to a persistent page-keyword identity. All foreign keys restrict deletion and key updates, preserving history across recrawls.

Crawl and page-crawl statuses use `0 = pending`, `1 = running/processing`, `2 = completed`, and `3 = failed`. Issue severity uses `1 = Info`, `2 = Warning`, and `3 = Critical`. The migrations enforce these values, relevance and ranking bounds, and the UTC date of each rank snapshot. `snapshotAt` must be supplied explicitly. Completed or failed crawl runs and page crawls and their historical details, plus rank snapshots, cannot be edited or deleted. Write page-crawl keywords and issues before marking a page crawl completed or failed. Normalize incoming emails with `normalizeEmail` before user creation or lookup; PostgreSQL also normalizes stored emails and enforces case-insensitive uniqueness. No application seed data is included.

## Website crawler

`pnpm crawl --client <uuid>` runs the crawler for a Client already in PostgreSQL. It reads the client's `websiteUrl`, discovers robots.txt and conventional sitemaps, traverses nested XML and gzip sitemaps in listed order, and selects up to 15 likely blog articles. The URL rules use general blog, article, news, guide, dated-path, and blog-subdomain patterns; they do not contain site-specific paths.

The crawler uses three concurrent page requests, a 12-second total request timeout, a 2 MB response limit, a 5-redirect limit, and public-IP checks for each destination. It extracts article text without navigation and computes a SHA-256 hash of normalized analyzed content. Keyword phrases use title, H1, headings, meta-description, and body-frequency signals; scores are rounded to four decimal places. Six initial SEO issue definitions are inserted into `SeoIssueTypes` on the first crawl.

Each crawl gets a new `CrawlRun`. Each selected URL gets a new `PageCrawl`; successful page details, keywords, and issues are saved in one database transaction before that page crawl becomes terminal. A failed page gets its own failed snapshot while other pages continue. Existing Pages, PageKeywords, previous PageCrawls, and RankSnapshots are retained. A run becomes terminal only after all selected pages have been recorded.