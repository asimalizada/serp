-- CreateTable
CREATE TABLE "Users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(320) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'America/Toronto',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Clients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "websiteUrl" TEXT NOT NULL,
    "normalizedDomain" VARCHAR(253) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrawlRuns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "clientId" UUID NOT NULL,
    "status" SMALLINT NOT NULL,
    "sitemapUrl" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ(6),
    "finishedAt" TIMESTAMPTZ(6),

    CONSTRAINT "CrawlRuns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "clientId" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageCrawls" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "crawlRunId" UUID NOT NULL,
    "pageId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "sitemapOrder" SMALLINT,
    "status" SMALLINT NOT NULL,
    "httpStatusCode" INTEGER,
    "title" TEXT,
    "metaDescription" TEXT,
    "h1" TEXT,
    "wordCount" INTEGER,
    "contentHash" VARCHAR(64),
    "error" TEXT,
    "processedAt" TIMESTAMPTZ(6),

    CONSTRAINT "PageCrawls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Keywords" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "phrase" VARCHAR(512) NOT NULL,

    CONSTRAINT "Keywords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageKeywords" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "pageId" UUID NOT NULL,
    "keywordId" UUID NOT NULL,

    CONSTRAINT "PageKeywords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageCrawlKeywords" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "pageCrawlId" UUID NOT NULL,
    "pageId" UUID NOT NULL,
    "keywordId" UUID NOT NULL,
    "relevanceScore" NUMERIC(5,4) NOT NULL,

    CONSTRAINT "PageCrawlKeywords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeoIssueTypes" (
    "id" SMALLINT NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "SeoIssueTypes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeoIssues" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "pageCrawlId" UUID NOT NULL,
    "issueTypeId" SMALLINT NOT NULL,
    "severity" SMALLINT NOT NULL,
    "details" TEXT NOT NULL,

    CONSTRAINT "SeoIssues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RankSnapshots" (
    "id" BIGSERIAL NOT NULL,
    "pageKeywordId" UUID NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "snapshotAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "position" SMALLINT NOT NULL,

    CONSTRAINT "RankSnapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Users_email_key" ON "Users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Clients_userId_normalizedDomain_key" ON "Clients"("userId", "normalizedDomain");

-- CreateIndex
CREATE UNIQUE INDEX "CrawlRuns_id_clientId_key" ON "CrawlRuns"("id", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Pages_clientId_url_key" ON "Pages"("clientId", "url");

-- CreateIndex
CREATE UNIQUE INDEX "Pages_id_clientId_key" ON "Pages"("id", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "PageCrawls_crawlRunId_pageId_key" ON "PageCrawls"("crawlRunId", "pageId");

-- CreateIndex
CREATE UNIQUE INDEX "PageCrawls_id_pageId_key" ON "PageCrawls"("id", "pageId");

-- CreateIndex
CREATE UNIQUE INDEX "Keywords_phrase_key" ON "Keywords"("phrase");

-- CreateIndex
CREATE UNIQUE INDEX "PageKeywords_pageId_keywordId_key" ON "PageKeywords"("pageId", "keywordId");

-- CreateIndex
CREATE UNIQUE INDEX "PageCrawlKeywords_pageCrawlId_keywordId_key" ON "PageCrawlKeywords"("pageCrawlId", "keywordId");

-- CreateIndex
CREATE UNIQUE INDEX "SeoIssueTypes_code_key" ON "SeoIssueTypes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "SeoIssues_pageCrawlId_issueTypeId_key" ON "SeoIssues"("pageCrawlId", "issueTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "RankSnapshots_pageKeywordId_snapshotDate_key" ON "RankSnapshots"("pageKeywordId", "snapshotDate");

-- AddForeignKey
ALTER TABLE "Clients" ADD CONSTRAINT "Clients_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CrawlRuns" ADD CONSTRAINT "CrawlRuns_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Clients"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Pages" ADD CONSTRAINT "Pages_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Clients"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PageCrawls" ADD CONSTRAINT "PageCrawls_crawlRunId_clientId_fkey" FOREIGN KEY ("crawlRunId", "clientId") REFERENCES "CrawlRuns"("id", "clientId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PageCrawls" ADD CONSTRAINT "PageCrawls_pageId_clientId_fkey" FOREIGN KEY ("pageId", "clientId") REFERENCES "Pages"("id", "clientId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PageKeywords" ADD CONSTRAINT "PageKeywords_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Pages"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PageKeywords" ADD CONSTRAINT "PageKeywords_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "Keywords"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PageCrawlKeywords" ADD CONSTRAINT "PageCrawlKeywords_pageCrawlId_pageId_fkey" FOREIGN KEY ("pageCrawlId", "pageId") REFERENCES "PageCrawls"("id", "pageId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PageCrawlKeywords" ADD CONSTRAINT "PageCrawlKeywords_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "Keywords"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PageCrawlKeywords" ADD CONSTRAINT "PageCrawlKeywords_pageId_keywordId_fkey" FOREIGN KEY ("pageId", "keywordId") REFERENCES "PageKeywords"("pageId", "keywordId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "SeoIssues" ADD CONSTRAINT "SeoIssues_pageCrawlId_fkey" FOREIGN KEY ("pageCrawlId") REFERENCES "PageCrawls"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "SeoIssues" ADD CONSTRAINT "SeoIssues_issueTypeId_fkey" FOREIGN KEY ("issueTypeId") REFERENCES "SeoIssueTypes"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "RankSnapshots" ADD CONSTRAINT "RankSnapshots_pageKeywordId_fkey" FOREIGN KEY ("pageKeywordId") REFERENCES "PageKeywords"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Prisma does not currently express CHECK constraints or column comments.
ALTER TABLE "CrawlRuns" ADD CONSTRAINT "CrawlRuns_status_check" CHECK ("status" IN (0, 1, 2, 3));
ALTER TABLE "PageCrawls" ADD CONSTRAINT "PageCrawls_status_check" CHECK ("status" IN (0, 1, 2, 3));
ALTER TABLE "PageCrawlKeywords" ADD CONSTRAINT "PageCrawlKeywords_relevanceScore_check" CHECK ("relevanceScore" BETWEEN 0 AND 1);
ALTER TABLE "PageCrawls" ADD CONSTRAINT "PageCrawls_contentHash_check" CHECK ("contentHash" IS NULL OR "contentHash" ~ '^[0-9a-fA-F]{64}$');
ALTER TABLE "SeoIssues" ADD CONSTRAINT "SeoIssues_severity_check" CHECK ("severity" IN (1, 2, 3));
ALTER TABLE "RankSnapshots" ADD CONSTRAINT "RankSnapshots_position_check" CHECK ("position" BETWEEN 1 AND 100);
ALTER TABLE "RankSnapshots" ADD CONSTRAINT "RankSnapshots_snapshotDate_utc_check" CHECK ("snapshotDate" = ("snapshotAt" AT TIME ZONE 'UTC')::date);

COMMENT ON COLUMN "CrawlRuns"."status" IS '0 = pending; 1 = running; 2 = completed; 3 = failed.';
COMMENT ON COLUMN "PageCrawls"."status" IS '0 = pending; 1 = processing; 2 = completed; 3 = failed.';
COMMENT ON COLUMN "SeoIssues"."severity" IS '1 = low; 2 = medium; 3 = high.';
COMMENT ON COLUMN "PageCrawls"."contentHash" IS 'SHA-256 hash of analyzed page content, encoded as 64 hexadecimal characters; raw HTML is not stored.';
COMMENT ON COLUMN "RankSnapshots"."snapshotDate" IS 'UTC calendar date of snapshotAt.';

-- Completed and failed analyses are historical records. Children must be written
-- while the page crawl is pending or processing, before its terminal status.
CREATE FUNCTION prevent_terminal_page_crawl_change() RETURNS trigger AS $$
BEGIN
  IF OLD."status" IN (2, 3) THEN
    RAISE EXCEPTION 'A completed or failed page crawl cannot be changed';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PageCrawls_preserve_history"
BEFORE UPDATE OR DELETE ON "PageCrawls"
FOR EACH ROW EXECUTE FUNCTION prevent_terminal_page_crawl_change();

CREATE FUNCTION prevent_terminal_page_crawl_child_change() RETURNS trigger AS $$
DECLARE
  parent_status SMALLINT;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    SELECT "status" INTO parent_status FROM "PageCrawls"
    WHERE "id" = OLD."pageCrawlId" FOR UPDATE;
    IF parent_status IN (2, 3) THEN
      RAISE EXCEPTION 'Historical page crawl details cannot be changed';
    END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    SELECT "status" INTO parent_status FROM "PageCrawls"
    WHERE "id" = NEW."pageCrawlId" FOR UPDATE;
    IF parent_status IN (2, 3) THEN
      RAISE EXCEPTION 'Historical page crawl details cannot be changed';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PageCrawlKeywords_preserve_history"
BEFORE INSERT OR UPDATE OR DELETE ON "PageCrawlKeywords"
FOR EACH ROW EXECUTE FUNCTION prevent_terminal_page_crawl_child_change();

CREATE TRIGGER "SeoIssues_preserve_history"
BEFORE INSERT OR UPDATE OR DELETE ON "SeoIssues"
FOR EACH ROW EXECUTE FUNCTION prevent_terminal_page_crawl_child_change();

-- Daily rank snapshots are append-only, including their UTC date and position.
CREATE FUNCTION prevent_rank_snapshot_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Rank snapshots are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "RankSnapshots_preserve_history"
BEFORE UPDATE OR DELETE ON "RankSnapshots"
FOR EACH ROW EXECUTE FUNCTION prevent_rank_snapshot_change();
