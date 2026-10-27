import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { SCHEMA_SQL } from './schema.js';

/** Anything that can run a parameterised query: the pool or an open DB transaction. */
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Db extends Queryable {
  /** Runs fn inside BEGIN/COMMIT; any thrown error rolls everything back. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  migrate(): Promise<void>;
  close(): Promise<void>;
}

export interface DbOptions {
  /** Postgres connection string (e.g. Supabase). When absent, embedded PGlite is used. */
  databaseUrl?: string;
  ssl?: boolean;
  /** PGlite data directory; undefined means in-memory. */
  pgliteDataDir?: string;
}

export async function createDb(opts: DbOptions): Promise<Db> {
  return opts.databaseUrl ? createPgDb(opts.databaseUrl, opts.ssl) : createPgliteDb(opts.pgliteDataDir);
}

function createPgDb(connectionString: string, ssl?: boolean): Db {
  const pool = new pg.Pool({
    connectionString,
    ssl: ssl ? { rejectUnauthorized: false } : undefined,
    max: 10,
  });

  return {
    async query(sql, params) {
      const res = await pool.query(sql, params);
      return { rows: res.rows };
    },
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({
          async query(sql, params) {
            const res = await client.query(sql, params);
            return { rows: res.rows };
          },
        });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    async migrate() {
      await pool.query(SCHEMA_SQL);
    },
    async close() {
      await pool.end();
    },
  };
}

async function createPgliteDb(dataDir?: string): Promise<Db> {
  // PGlite only creates the last path segment, so a fresh checkout would fail on ./data/pglite.
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const db = new PGlite(dataDir);
  await db.waitReady;

  return {
    async query(sql, params) {
      const res = await db.query(sql, params);
      return { rows: res.rows as never[] };
    },
    async transaction(fn) {
      return db.transaction(async (tx) =>
        fn({
          async query(sql, params) {
            const res = await tx.query(sql, params);
            return { rows: res.rows as never[] };
          },
        }),
      );
    },
    async migrate() {
      await db.exec(SCHEMA_SQL);
    },
    async close() {
      await db.close();
    },
  };
}

/** Postgres SQLSTATE codes we react to. */
export const PG_ERROR = {
  UNIQUE_VIOLATION: '23505',
  CHECK_VIOLATION: '23514',
  FOREIGN_KEY_VIOLATION: '23503',
} as const;

export function pgErrorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : undefined;
}

export function pgConstraint(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'constraint' in err
    ? String((err as { constraint: unknown }).constraint)
    : undefined;
}
