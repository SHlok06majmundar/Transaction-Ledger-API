import request from 'supertest';
import { afterAll, beforeAll, expect } from 'vitest';
import { createApp } from '../../src/app.js';
import { createDb, type Db } from '../../src/db/client.js';

export const MISSING_ID = '00000000-0000-4000-8000-000000000000';

/**
 * Boots the app against a fresh in-memory PGlite database per test file.
 * Set TEST_DATABASE_URL to run the same suites against real PostgreSQL / Supabase.
 */
export function setupTestApp() {
  const ctx = {} as { db: Db; app: ReturnType<typeof createApp> };

  beforeAll(async () => {
    ctx.db = await createDb({ databaseUrl: process.env.TEST_DATABASE_URL });
    await ctx.db.migrate();
    ctx.app = createApp(ctx.db);
  });

  afterAll(async () => {
    await ctx.db.close();
  });

  let refSeq = 0;
  const ref = () => `ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${++refSeq}`;

  const api = () => request(ctx.app);

  async function newAccount(name = 'Alice') {
    const res = await api().post('/api/accounts').send({ name });
    expect(res.status).toBe(201);
    return res.body.data as { id: string; name: string; balance: number };
  }

  const txn = (accountId: string, body: Record<string, unknown>) =>
    api().post(`/api/accounts/${accountId}/transactions`).send(body);

  const history = (accountId: string, query = '') => api().get(`/api/accounts/${accountId}/transactions${query}`);

  async function balanceOf(accountId: string) {
    const res = await api().get(`/api/accounts/${accountId}/balance`);
    expect(res.status).toBe(200);
    return res.body.data.balance as number;
  }

  /** Creates an account and credits it with `amount`. */
  async function fundedAccount(amount: number) {
    const account = await newAccount();
    if (amount > 0) expect((await txn(account.id, { type: 'credit', amount, reference_id: ref() })).status).toBe(201);
    return account.id;
  }

  return { ctx, api, ref, newAccount, txn, history, balanceOf, fundedAccount };
}
