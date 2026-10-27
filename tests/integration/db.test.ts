import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDb } from '../../src/db/client.js';

describe('createDb (embedded PGlite)', () => {
  it('creates a nested data directory that does not exist yet (fresh checkout)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ledger-'));
    const db = await createDb({ pgliteDataDir: join(root, 'data', 'pglite') });
    try {
      await db.migrate();
      await db.migrate(); // idempotent
      expect((await db.query<{ ok: number }>('SELECT 1 AS ok')).rows[0].ok).toBe(1);
    } finally {
      await db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
