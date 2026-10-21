BEGIN;

ALTER TABLE "Clients" ADD COLUMN "archivedAt" TIMESTAMPTZ(6);

-- One unfinished crawl per client, including jobs left running after a crash.
-- Fail explicitly if pre-existing data violates this rule; never remove history.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "CrawlRuns"
    WHERE "status" IN (0, 1)
    GROUP BY "clientId" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Multiple pending or running crawl runs exist for a client; resolve them before applying this migration';
  END IF;
END $$;

CREATE UNIQUE INDEX "CrawlRuns_one_active_per_client_key"
  ON "CrawlRuns"("clientId") WHERE "status" IN (0, 1);

COMMIT;