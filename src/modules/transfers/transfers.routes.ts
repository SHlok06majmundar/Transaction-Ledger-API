import { Router } from 'express';
import type { Db } from '../../db/client.js';
import { parse } from '../../shared/validation.js';
import { createTransferSchema } from './transfers.schema.js';
import { createTransfer } from './transfers.service.js';

export function transfersRouter(db: Db) {
  const router = Router();

  router.post('/', async (req, res) => {
    const input = parse(createTransferSchema, req.body ?? {});
    res.status(201).json({ data: await createTransfer(db, input) });
  });

  return router;
}
