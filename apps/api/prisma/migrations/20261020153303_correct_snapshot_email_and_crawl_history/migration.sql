BEGIN;

-- Keep the applied initial migration intact. Historical timestamps are explicit.
ALTER TABLE "RankSnapshots" ALTER COLUMN "snapshotAt" DROP DEFAULT;

COMMENT ON COLUMN "SeoIssues"."severity" IS '1 = Info; 2 = Warning; 3 = Critical.';

-- Lock writes while detecting collisions and normalizing existing rows. Abort
-- without changing data if existing addresses would become duplicates.
LOCK TABLE "Users" IN SHARE ROW EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Users"
    GROUP BY lower(btrim("email"))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Users.email contains duplicates after trim/lowercase normalization';
  END IF;
END;
$$ LANGUAGE plpgsql;

UPDATE "Users"
SET "email" = lower(btrim("email"))
WHERE "email" <> lower(btrim("email"));

CREATE UNIQUE INDEX "Users_email_normalized_key" ON "Users" (lower(btrim("email")));

-- Keep direct database writes normalized as well as application-boundary input.
CREATE FUNCTION normalize_user_email() RETURNS trigger AS $$
BEGIN
  NEW."email" := lower(btrim(NEW."email"));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Users_normalize_email"
BEFORE INSERT OR UPDATE OF "email" ON "Users"
FOR EACH ROW EXECUTE FUNCTION normalize_user_email();

-- Allow ordinary in-progress edits, but only 0 -> 1 -> (2 or 3) status changes.
-- A terminal crawl run is historical and cannot be updated or deleted.
CREATE FUNCTION protect_crawl_run_history() RETURNS trigger AS $$
BEGIN
  IF OLD."status" IN (2, 3) THEN
    RAISE EXCEPTION 'A completed or failed crawl run cannot be changed';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF NEW."status" <> OLD."status" AND NOT (
    (OLD."status" = 0 AND NEW."status" = 1) OR
    (OLD."status" = 1 AND NEW."status" IN (2, 3))
  ) THEN
    RAISE EXCEPTION 'Invalid crawl run status transition';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CrawlRuns_preserve_history"
BEFORE UPDATE OR DELETE ON "CrawlRuns"
FOR EACH ROW EXECUTE FUNCTION protect_crawl_run_history();

COMMIT;
