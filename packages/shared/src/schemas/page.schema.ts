import { z } from 'zod';

const paginationParam = (defaultValue: number, min: number, max?: number) =>
  z.preprocess(
    (val) => {
      if (val === undefined) return defaultValue;
      if (typeof val === 'string' && /^-?\d+$/.test(val.trim())) {
        return parseInt(val.trim(), 10);
      }
      return val;
    },
    max !== undefined
      ? z.number({ message: 'Must be an integer' }).int().min(min).max(max)
      : z.number({ message: 'Must be an integer' }).int().min(min),
  );

export const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .refine(
    (str) => {
      const [y, m, d] = str.split('-').map(Number);
      const date = new Date(Date.UTC(y, m - 1, d));
      return (
        date.getUTCFullYear() === y &&
        date.getUTCMonth() === m - 1 &&
        date.getUTCDate() === d
      );
    },
    { message: 'Invalid calendar date' },
  );

export const pageListQuerySchema = z
  .object({
    clientId: z.string().uuid('Invalid client UUID').optional(),
    url: z.string().max(200, 'URL filter must be at most 200 characters').optional(),
    keyword: z.string().max(200, 'Keyword filter must be at most 200 characters').optional(),
    search: z.string().max(200, 'Search filter must be at most 200 characters').optional(),
    page: paginationParam(1, 1),
    pageSize: paginationParam(20, 1, 100),
  })
  .strict();

export type PageListQueryInput = z.input<typeof pageListQuerySchema>;
export type PageListQueryOutput = z.output<typeof pageListQuerySchema>;
export type PageListQuery = PageListQueryOutput;

export const rankHistoryQuerySchema = z
  .object({
    keywordId: z.string().uuid('Invalid keyword UUID').optional(),
    from: calendarDateSchema.optional(),
    to: calendarDateSchema.optional(),
  })
  .strict();

export type RankHistoryQueryInput = z.input<typeof rankHistoryQuerySchema>;
export type RankHistoryQueryOutput = z.output<typeof rankHistoryQuerySchema>;
export type RankHistoryQuery = RankHistoryQueryOutput;
