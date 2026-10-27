import { Router } from 'express';
import type { Db } from '../../db/client.js';
import { validateUuidParam } from '../../middleware/validateParams.js';
import { parse } from '../../shared/validation.js';
import { transactionsRouter } from '../transactions/transactions.routes.js';
import { createAccountSchema } from './accounts.schema.js';
import * as accounts from './accounts.service.js';

export function accountsRouter(db: Db) {
  const router = Router();
  router.param('accountId', validateUuidParam('accountId'));

  router.post('/', async (req, res) => {
    const input = parse(createAccountSchema, req.body ?? {});
    res.status(201).json({ data: await accounts.createAccount(db, input) });
  });

  router.get('/', async (_req, res) => {
    res.json({ data: await accounts.listAccounts(db) });
  });

  router.get('/:accountId', async (req, res) => {
    res.json({ data: await accounts.getAccount(db, req.params.accountId) });
  });

  router.get('/:accountId/balance', async (req, res) => {
    res.json({ data: await accounts.getBalance(db, req.params.accountId) });
  });

  router.use('/:accountId/transactions', transactionsRouter(db));

  return router;
}
