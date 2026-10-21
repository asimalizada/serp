import { z } from 'zod';

export function isValidIanaTimezone(timeZone: string): boolean {
  if (!timeZone || typeof timeZone !== 'string') {
    return false;
  }
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

export const updateTimezoneSchema = z
  .object({
    timezone: z
      .string()
      .min(1, 'Timezone is required')
      .max(64, 'Timezone must be at most 64 characters')
      .refine(isValidIanaTimezone, {
        message: 'A valid IANA timezone is required',
      }),
  })
  .strict();

export type UpdateTimezoneInput = z.infer<typeof updateTimezoneSchema>;
