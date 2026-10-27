import { Router } from 'express';
import type { Db } from '../../db/client.js';
import { errors } from '../../shared/errors.js';
import { parse } from '../../shared/validation.js';
import { createTransactionSchema, listTransactionsQuerySchema } from './transactions.schema.js';
import * as transactions from './transactions.service.js';

/** Mounted at /api/accounts/:accountId/transactions (accountId already validated by the parent router). */
export function transactionsRouter(db: Db) {
  const router = Router({ mergeParams: true });

  router.post('/', async (req, res) => {
    const { accountId } = req.params as { accountId: string };
    const input = parse(createTransactionSchema, req.body ?? {});
    const result = await transactions.createTransaction(db, accountId, input);
    res.status(201).json({ data: result.transaction, meta: { balance: result.balance } });
  });

  router.get('/', async (req, res) => {
    const { accountId } = req.params as { accountId: string };
    const query = parse(listTransactionsQuerySchema, req.query, 'Query parameters');
    res.json(await transactions.listTransactions(db, accountId, query));
  });

  // Transactions are append-only: no edit or delete through the API.
  router.all(['/', '/:transactionId'], (req, _res, next) => {
    if (['PUT', 'PATCH', 'DELETE'].includes(req.method)) return next(errors.immutable());
    next();
  });

  return router;
}
