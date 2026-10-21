import { z } from 'zod';

export const createClientSchema = z
  .object({
    websiteUrl: z.string().url('Invalid website URL'),
    name: z.string().max(255, 'Client name must be at most 255 characters').optional(),
  })
  .strict();

export type CreateClientInput = z.infer<typeof createClientSchema>;
