import { describe, expect, it } from 'vitest';
import { setupTestApp } from '../helpers/testApp.js';

const { ctx, api, ref, newAccount, txn, history, balanceOf, fundedAccount } = setupTestApp();

describe('Balance consistency', () => {
  it('matches the worked example from the brief (0 +100 +50 -30 -20 = 100)', async () => {
    const { id } = await newAccount();
    for (const [type, amount] of [['credit', 100], ['credit', 50], ['debit', 30], ['debit', 20]] as const) {
      expect((await txn(id, { type, amount, reference_id: ref() })).status).toBe(201);
    }
    expect(await balanceOf(id)).toBe(100);
  });

  it('always equals the sum of recorded transactions', async () => {
    const id = await fundedAccount(500);
    const ops = [
      { type: 'debit', amount: 120.5 },
      { type: 'debit', amount: 1000 }, // rejected
      { type: 'credit', amount: 75.25 },
      { type: 'debit', amount: 0 }, // rejected (validation)
      { type: 'debit', amount: 454.75 },
    ];
    for (const op of ops) await txn(id, { ...op, reference_id: ref() });

    const { rows } = await ctx.db.query<{ total: string }>(
      `SELECT COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE -amount END), 0) AS total
         FROM transactions WHERE account_id = $1`,
      [id],
    );
    expect(await balanceOf(id)).toBe(Number(rows[0].total));
    expect(await balanceOf(id)).toBe(0);
  });
});

describe('Concurrency', () => {
  it('never goes negative under concurrent debits', async () => {
    const id = await fundedAccount(100);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => txn(id, { type: 'debit', amount: 30, reference_id: ref() })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(results.filter((r) => r.status === 422)).toHaveLength(7);
    expect(await balanceOf(id)).toBe(10);
  });

  it('applies concurrent submissions of the same reference_id exactly once', async () => {
    const { id } = await newAccount();
    const reference_id = ref();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => txn(id, { type: 'credit', amount: 25, reference_id })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(7);
    expect(await balanceOf(id)).toBe(25);
  });

  it('does not deadlock or lose money with concurrent opposite transfers', async () => {
    const [a, b] = await Promise.all([fundedAccount(1000), fundedAccount(1000)]);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        api()
          .post('/api/transfers')
          .send({ from_account_id: i % 2 ? a : b, to_account_id: i % 2 ? b : a, amount: 10 + i, reference_id: ref() }),
      ),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect((await balanceOf(a)) + (await balanceOf(b))).toBe(2000);
  });
});

describe('Immutability', () => {
  it('exposes no way to edit or delete a transaction', async () => {
    const id = await fundedAccount(10);
    const txnId = (await history(id)).body.data[0].id;

    for (const method of ['put', 'patch', 'delete'] as const) {
      for (const path of [`/api/accounts/${id}/transactions/${txnId}`, `/api/accounts/${id}/transactions`]) {
        const res = await api()[method](path).send({ amount: 999 });
        expect(res.status).toBe(405);
        expect(res.body.error.code).toBe('TRANSACTION_IMMUTABLE');
      }
    }
    expect(await balanceOf(id)).toBe(10);
  });

  it('is enforced by the database even outside the API', async () => {
    const id = await fundedAccount(10);
    await expect(ctx.db.query(`UPDATE transactions SET amount = 1 WHERE account_id = $1`, [id])).rejects.toThrow(
      /immutable/,
    );
    await expect(ctx.db.query(`DELETE FROM transactions WHERE account_id = $1`, [id])).rejects.toThrow(/immutable/);
  });
});

describe('Database constraints', () => {
  it('rejects a negative balance at the database level', async () => {
    const { id } = await newAccount();
    await expect(ctx.db.query(`UPDATE accounts SET balance = -1 WHERE id = $1`, [id])).rejects.toMatchObject({
      code: '23514',
    });
  });

  it('rejects a duplicate (account_id, reference_id) at the database level', async () => {
    const { id } = await newAccount();
    const insert = () =>
      ctx.db.query(`INSERT INTO transactions (account_id, type, amount, reference_id) VALUES ($1, 'credit', 1, 'X')`, [
        id,
      ]);
    await insert();
    await expect(insert()).rejects.toMatchObject({ code: '23505' });
  });
});

describe('Atomicity', () => {
  it('rolls back the balance update when the transaction insert fails', async () => {
    const { id } = await newAccount();
    await expect(
      ctx.db.transaction(async (tx) => {
        await tx.query(`UPDATE accounts SET balance = balance + 500 WHERE id = $1`, [id]);
        // amount = -1 violates CHECK (amount > 0), so the whole DB transaction must roll back.
        await tx.query(`INSERT INTO transactions (account_id, type, amount, reference_id) VALUES ($1, 'credit', -1, 'bad')`, [
          id,
        ]);
      }),
    ).rejects.toThrow();
    expect(await balanceOf(id)).toBe(0);
  });
});

describe('Misc', () => {
  it('returns a consistent 404 for unknown routes', async () => {
    const res = await api().get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
  });

  it('serves health and OpenAPI docs', async () => {
    expect((await api().get('/health')).body).toEqual({ status: 'ok' });
    expect((await api().get('/openapi.json')).body.openapi).toMatch(/^3\./);
    expect((await api().get('/docs/')).status).toBe(200);
  });
});
