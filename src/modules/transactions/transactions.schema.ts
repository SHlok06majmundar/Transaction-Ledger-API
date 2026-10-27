import { z } from 'zod';
import { amount, description, positiveIntParam, referenceId } from '../../shared/validation.js';

export const MAX_PAGE_LIMIT = 100;
export const DEFAULT_PAGE_LIMIT = 20;

const transactionType = z.enum(['credit', 'debit'], { error: "type must be 'credit' or 'debit'" });

export const createTransactionSchema = z
  .object({
    type: transactionType,
    amount,
    description,
    reference_id: referenceId,
  })
  .strict();

export const listTransactionsQuerySchema = z.object({
  type: transactionType.optional(),
  page: positiveIntParam('page').default(1),
  limit: positiveIntParam('limit')
    .pipe(z.number().max(MAX_PAGE_LIMIT, `limit must be at most ${MAX_PAGE_LIMIT}`))
    .default(DEFAULT_PAGE_LIMIT),
});

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;
export type ListTransactionsQuery = z.infer<typeof listTransactionsQuerySchema>;
