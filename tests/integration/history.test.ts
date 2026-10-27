import { beforeAll, describe, expect, it } from 'vitest';
import { MISSING_ID, setupTestApp } from '../helpers/testApp.js';

const { api, newAccount, txn, history } = setupTestApp();

describe('GET /api/accounts/:id/transactions', () => {
  let accountId: string;
  const list = (query = '') => history(accountId, query);
  const refs = (body: { data: { reference_id: string }[] }) => body.data.map((t) => t.reference_id);

  beforeAll(async () => {
    ({ id: accountId } = await newAccount());
    // 7 credits then 5 debits, created sequentially so order is deterministic.
    for (let i = 1; i <= 7; i++) await txn(accountId, { type: 'credit', amount: 100, reference_id: `c${i}` });
    for (let i = 1; i <= 5; i++) await txn(accountId, { type: 'debit', amount: 10, reference_id: `d${i}` });
  });

  it('returns all transactions latest-first with default pagination', async () => {
    const res = await list();
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(12);
    expect(res.body.data[0].reference_id).toBe('d5');
    expect(res.body.data[11].reference_id).toBe('c1');

    const times = res.body.data.map((t: { created_at: string }) => new Date(t.created_at).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);

    expect(res.body.pagination).toEqual({
      page: 1,
      limit: 20,
      total_records: 12,
      total_pages: 1,
      has_next_page: false,
      has_previous_page: false,
    });
    expect(res.body.filters).toEqual({ type: null });
  });

  it('filters by type', async () => {
    const credits = await list('?type=credit');
    expect(credits.body.data).toHaveLength(7);
    expect(credits.body.data.every((t: { type: string }) => t.type === 'credit')).toBe(true);
    expect(credits.body.filters).toEqual({ type: 'credit' });

    const debits = await list('?type=debit');
    expect(debits.body.pagination.total_records).toBe(5);
  });

  it('paginates', async () => {
    const p1 = await list('?limit=5&page=1');
    expect(refs(p1.body)).toEqual(['d5', 'd4', 'd3', 'd2', 'd1']);
    expect(p1.body.pagination).toMatchObject({ page: 1, limit: 5, total_pages: 3, has_next_page: true });

    const p2 = await list('?limit=5&page=2');
    expect(refs(p2.body)).toEqual(['c7', 'c6', 'c5', 'c4', 'c3']);

    const p3 = await list('?limit=5&page=3');
    expect(refs(p3.body)).toEqual(['c2', 'c1']);
    expect(p3.body.pagination).toMatchObject({ page: 3, has_next_page: false, has_previous_page: true });
  });

  it('combines filter and pagination', async () => {
    const res = await list('?type=credit&limit=3&page=3');
    expect(refs(res.body)).toEqual(['c1']);
    expect(res.body.pagination).toMatchObject({ total_records: 7, total_pages: 3 });
  });

  it('returns an empty page past the end', async () => {
    const res = await list('?page=99');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.total_records).toBe(12);
  });

  it('returns an empty list for an account with no transactions', async () => {
    const { id } = await newAccount();
    const res = await history(id);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination).toMatchObject({ total_records: 0, total_pages: 0 });
  });

  it.each(['?page=0', '?page=-1', '?page=abc', '?page=', '?limit=0', '?limit=101', '?limit=2.5', '?type=refund', '?page=1&page=2'])(
    'rejects invalid query %s',
    async (q) => {
      const res = await list(q);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    },
  );

  it('returns 404 for an unknown account', async () => {
    const res = await api().get(`/api/accounts/${MISSING_ID}/transactions`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ACCOUNT_NOT_FOUND');
  });
});
