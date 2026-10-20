import { PrismaClient } from '../generated/prisma/client';

const DAY_MS = 86_400_000;
const MIN_SNAPSHOTS = 50_000;
const MIN_DAYS = 365;
const PAIR_BATCH = 100;
const DAY_BATCH = 90;
const INSERT_BATCH = 1_000;

function hash32(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function deterministicPosition(pageKeywordId: string, snapshotDate: Date): number {
  const day = Math.floor(snapshotDate.getTime() / DAY_MS);
  const baseline = 10 + hash32(pageKeywordId) % 76;
  const phase = (hash32(`${pageKeywordId}:phase`) / 0x100000000) * Math.PI * 2;
  const phase2 = (hash32(`${pageKeywordId}:phase2`) / 0x100000000) * Math.PI * 2;
  const variation = (hash32(`${pageKeywordId}:${day}`) % 3) - 1;
  const position = Math.round(baseline + 9 * Math.sin(day / 19 + phase) + 5 * Math.sin(day / 53 + phase2) + variation);
  return Math.max(1, Math.min(100, position));
}

export function snapshotDates(now: Date, pairCount: number): { firstDay: number; lastDay: number; days: number } {
  if (pairCount < 1) throw new Error('No PageKeywords exist; cannot generate rank snapshots');
  const days = Math.max(MIN_DAYS, Math.ceil(MIN_SNAPSHOTS / pairCount));
  const lastDay = Math.floor(now.getTime() / DAY_MS);
  return { firstDay: lastDay - days + 1, lastDay, days };
}

export interface RankGenerationResult {
  pairs: number;
  days: number;
  firstDate: string;
  lastDate: string;
  inserted: number;
  total: number;
  elapsedMs: number;
}

function dateAt(day: number, hour = 0): Date {
  return new Date(day * DAY_MS + hour * 3_600_000);
}

export async function generateRankSnapshots(prisma: PrismaClient, now = new Date()): Promise<RankGenerationResult> {
  const start = performance.now();
  const pairs = await prisma.pageKeyword.count();
  const { firstDay, lastDay, days } = snapshotDates(now, pairs);
  let inserted = 0;
  let lastId: string | undefined;
  while (true) {
    const pageKeywords = await prisma.pageKeyword.findMany({
      where: lastId ? { id: { gt: lastId } } : undefined,
      orderBy: { id: 'asc' }, take: PAIR_BATCH, select: { id: true },
    });
    if (!pageKeywords.length) break;
    lastId = pageKeywords.at(-1)!.id;
    const ids = pageKeywords.map(({ id }) => id);
    for (let first = firstDay; first <= lastDay; first += DAY_BATCH) {
      const last = Math.min(lastDay, first + DAY_BATCH - 1);
      const existing = await prisma.rankSnapshot.findMany({
        where: { pageKeywordId: { in: ids }, snapshotDate: { gte: dateAt(first), lte: dateAt(last) } },
        select: { pageKeywordId: true, snapshotDate: true },
      });
      const present = new Set(existing.map(({ pageKeywordId, snapshotDate }) => `${pageKeywordId}:${snapshotDate.toISOString().slice(0, 10)}`));
      let batch: { pageKeywordId: string; snapshotDate: Date; snapshotAt: Date; position: number }[] = [];
      for (const id of ids) {
        for (let day = first; day <= last; day++) {
          const snapshotDate = dateAt(day);
          if (present.has(`${id}:${snapshotDate.toISOString().slice(0, 10)}`)) continue;
          batch.push({ pageKeywordId: id, snapshotDate, snapshotAt: dateAt(day, 12), position: deterministicPosition(id, snapshotDate) });
          if (batch.length === INSERT_BATCH) {
            inserted += (await prisma.rankSnapshot.createMany({ data: batch, skipDuplicates: true })).count;
            batch = [];
          }
        }
      }
      if (batch.length) inserted += (await prisma.rankSnapshot.createMany({ data: batch, skipDuplicates: true })).count;
    }
  }
  const total = await prisma.rankSnapshot.count();
  if (total < MIN_SNAPSHOTS) throw new Error(`Expected at least ${MIN_SNAPSHOTS} snapshots, found ${total}`);
  return { pairs, days, firstDate: dateAt(firstDay).toISOString().slice(0, 10),
    lastDate: dateAt(lastDay).toISOString().slice(0, 10), inserted, total, elapsedMs: Math.round(performance.now() - start) };
}