import crypto from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { PrismaService } from '../../database/prisma.service';

export interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

@Injectable()
export class PostgresThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly prisma: PrismaService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    _throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const effectiveTtl = Math.max(1, Math.round(Number(ttl) || 1000));
    const effectiveLimit = Math.max(1, Math.round(Number(limit) || 1));
    const effectiveBlockDuration =
      typeof blockDuration === 'number' && blockDuration > 0
        ? Math.round(blockDuration)
        : effectiveTtl;

    // Keys in AuthThrottles table have a VARCHAR(64) limit.
    // If a key exceeds 64 characters, hash it to 64 hex characters via SHA-256.
    const storageKey =
      key.length > 64
        ? crypto.createHash('sha256').update(key).digest('hex')
        : key;

    const rows = await this.prisma.$queryRaw<
      Array<{
        hits: number;
        expiresAt: Date;
        remaining_seconds: number;
      }>
    >`
      INSERT INTO "AuthThrottles" ("key", "hits", "expiresAt")
      VALUES (
        ${storageKey},
        1,
        statement_timestamp() + (${effectiveTtl} * interval '1 millisecond')
      )
      ON CONFLICT ("key") DO UPDATE SET
        "hits" = CASE
          WHEN "AuthThrottles"."expiresAt" <= statement_timestamp() THEN 1
          ELSE "AuthThrottles"."hits" + 1
        END,
        "expiresAt" = CASE
          WHEN "AuthThrottles"."expiresAt" <= statement_timestamp() THEN
            statement_timestamp() + (${effectiveTtl} * interval '1 millisecond')
          WHEN "AuthThrottles"."hits" = ${effectiveLimit} AND ${effectiveBlockDuration} > 0 THEN
            statement_timestamp() + (${effectiveBlockDuration} * interval '1 millisecond')
          ELSE "AuthThrottles"."expiresAt"
        END
      RETURNING
        "hits",
        "expiresAt",
        GREATEST(0, ceil(EXTRACT(EPOCH FROM ("expiresAt" - statement_timestamp())))::int) AS "remaining_seconds"
    `;

    const row = rows[0];
    const isBlocked = row.hits > effectiveLimit;
    const timeToExpire = row.remaining_seconds;
    const timeToBlockExpire = isBlocked ? row.remaining_seconds : 0;

    return {
      totalHits: row.hits,
      timeToExpire,
      isBlocked,
      timeToBlockExpire,
    };
  }

  async deleteExpiredThrottles(now: Date = new Date()): Promise<number> {
    const result = await this.prisma.authThrottle.deleteMany({
      where: { expiresAt: { lt: now } },
    });
    return result.count;
  }
}