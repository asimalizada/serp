-- Replace obsolete AuthSessions table with RefreshTokens model for JWT architecture
CREATE TABLE "RefreshTokens" (
  "tokenHash" VARCHAR(64) NOT NULL,
  "userId" UUID NOT NULL,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RefreshTokens_pkey" PRIMARY KEY ("tokenHash")
);

ALTER TABLE "RefreshTokens" ADD CONSTRAINT "RefreshTokens_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "Users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP TABLE IF EXISTS "AuthSessions";
