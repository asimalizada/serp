import { z } from 'zod';

export const loginSchema = z
  .object({
    email: z
      .string()
      .min(1, 'Email is required')
      .transform((val) => val.trim().toLowerCase())
      .pipe(
        z
          .string()
          .min(1, 'Email is required')
          .email('Invalid email address')
          .max(320, 'Email must be at most 320 characters'),
      ),
    password: z
      .string()
      .min(1, 'Password is required')
      .refine(
        (val) => new TextEncoder().encode(val).length <= 72,
        'Password must not exceed 72 bytes',
      ),
  })
  .strict();

export type LoginInput = z.infer<typeof loginSchema>;
