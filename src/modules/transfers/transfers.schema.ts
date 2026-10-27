import { z } from 'zod';
import { amount, description, referenceId, uuid } from '../../shared/validation.js';

export const createTransferSchema = z
  .object({
    from_account_id: uuid,
    to_account_id: uuid,
    amount,
    description,
    reference_id: referenceId,
  })
  .strict()
  .refine((t) => t.from_account_id !== t.to_account_id, {
    message: 'from_account_id and to_account_id must be different',
    path: ['to_account_id'],
  });

export type CreateTransferInput = z.infer<typeof createTransferSchema>;
