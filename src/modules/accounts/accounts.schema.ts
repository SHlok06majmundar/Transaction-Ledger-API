import { z } from 'zod';

// .strict() rejects unknown keys, which is how "client cannot set balance / id / created_at" is enforced.
export const createAccountSchema = z
  .object({
    name: z.string({ error: 'name is required' }).trim().min(1, 'name is required').max(255),
  })
  .strict();

export type CreateAccountInput = z.infer<typeof createAccountSchema>;
