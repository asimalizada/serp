CREATE TABLE "AuthSessions" (
  "tokenHash" VARCHAR(64) NOT NULL,
  "userId" UUID NOT NULL,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthSessions_pkey" PRIMARY KEY ("tokenHash")
);

CREATE TABLE "AuthThrottles" (
  "key" VARCHAR(64) NOT NULL,
  "hits" INTEGER NOT NULL,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "AuthThrottles_pkey" PRIMARY KEY ("key"),
  CONSTRAINT "AuthThrottles_hits_check" CHECK ("hits" >= 1)
);

ALTER TABLE "AuthSessions" ADD CONSTRAINT "AuthSessions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "Users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
