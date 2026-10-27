import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';
import type { Db } from './db/client.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { accountsRouter } from './modules/accounts/accounts.routes.js';
import { transfersRouter } from './modules/transfers/transfers.routes.js';

const openapiPath = fileURLToPath(new URL('../docs/openapi.yaml', import.meta.url));

export function createApp(db: Db) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));

  app.get('/health', async (_req, res) => {
    await db.query('SELECT 1');
    res.json({ status: 'ok' });
  });

  app.get('/', (_req, res) => res.redirect('/docs'));

  const openapi = YAML.parse(readFileSync(openapiPath, 'utf8'));
  app.get('/openapi.json', (_req, res) => res.json(openapi));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi));

  app.use('/api/accounts', accountsRouter(db));
  app.use('/api/transfers', transfersRouter(db));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
