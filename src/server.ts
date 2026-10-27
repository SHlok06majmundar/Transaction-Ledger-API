import { createApp } from './app.js';
import { env } from './config/env.js';
import { createDb } from './db/client.js';

const db = await createDb({
  databaseUrl: env.DATABASE_URL,
  ssl: env.DATABASE_SSL,
  pgliteDataDir: env.PGLITE_DATA_DIR,
});
await db.migrate();

const server = createApp(db).listen(env.PORT, () => {
  const mode = env.DATABASE_URL ? 'PostgreSQL (DATABASE_URL)' : `embedded PGlite (${env.PGLITE_DATA_DIR})`;
  console.log(`Ledger API listening on http://localhost:${env.PORT}  | db: ${mode} | docs: /docs`);
});

async function shutdown() {
  server.close();
  await db.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
