import { PageContent } from './content';

const STOP_WORDS = new Set(`a an and are as at be been but by can do does for from had has have how in into is it its of on or our that the their these this those to was were what when where which who why will with you your about after all also any best more most not over than then they them there through use using via way ways`.split(' '));

export interface ScoredKeyword {
  phrase: string;
  relevanceScore: number;
}

function tokens(value: string): string[] {
  return value.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function phrases(value: string): string[] {
  const words = tokens(value);
  const result: string[] = [];
  for (let i = 0; i < words.length; i++) {
    for (let size = 1; size <= 3 && i + size <= words.length; size++) {
      const group = words.slice(i, i + size);
      if (group.some((word) => word.length < 3 || STOP_WORDS.has(word)) || group.every((word) => /^\d+$/.test(word))) continue;
      const phrase = group.join(' ');
      if (phrase.length <= 512) result.push(phrase);
    }
  }
  return result;
}

export function extractKeywords(content: PageContent, limit = 12): ScoredKeyword[] {
  const body = phrases(content.text);
  const counts = new Map<string, number>();
  for (const phrase of body) counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
  const title = new Set(phrases(content.title ?? ''));
  const h1 = new Set(phrases(content.h1 ?? ''));
  const meta = new Set(phrases(content.metaDescription ?? ''));
  const headings = new Set(content.headings.flatMap(phrases));
  const candidates = new Set([...title, ...h1, ...meta, ...headings, ...[...counts].filter(([, count]) => count >= 2).map(([phrase]) => phrase)]);
  return [...candidates]
    .map((phrase) => {
      const frequency = counts.get(phrase) ?? 0;
      const bodySignal = Math.min(0.2, (frequency / Math.max(3, content.wordCount / 100)) * 0.2);
      const score = (title.has(phrase) ? 0.35 : 0) + (h1.has(phrase) ? 0.25 : 0) +
        (headings.has(phrase) ? 0.15 : 0) + (meta.has(phrase) ? 0.15 : 0) + bodySignal;
      return { phrase, relevanceScore: Math.min(1, Math.round(score * 10_000) / 10_000) };
    })
    .filter((item) => item.relevanceScore > 0)
    .sort((a, b) => b.relevanceScore - a.relevanceScore || b.phrase.split(' ').length - a.phrase.split(' ').length || a.phrase.localeCompare(b.phrase))
    .slice(0, limit);
}