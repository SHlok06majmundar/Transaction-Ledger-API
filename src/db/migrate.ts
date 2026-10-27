import { env } from '../config/env.js';
import { createDb } from './client.js';

// Standalone migration: `npm run db:migrate` (the server also migrates on boot).
const db = await createDb({ databaseUrl: env.DATABASE_URL, ssl: env.DATABASE_SSL, pgliteDataDir: env.PGLITE_DATA_DIR });
await db.migrate();
await db.close();
console.log('Schema is up to date.');
