import { describe, expect, it } from 'vitest';
import { MISSING_ID, setupTestApp } from '../helpers/testApp.js';

const { api, newAccount } = setupTestApp();

describe('POST /api/accounts', () => {
  it('creates an account with system-generated id, created_at and zero balance', async () => {
    const res = await api().post('/api/accounts').send({ name: '  Alice  ' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: 'Alice', balance: 0 });
    expect(res.body.data.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(res.body.data.created_at).getTime()).not.toBeNaN();
  });

  it('generates unique ids', async () => {
    const [a, b] = await Promise.all([newAccount(), newAccount()]);
    expect(a.id).not.toBe(b.id);
  });

  it.each([[{ balance: 1000 }], [{ id: MISSING_ID }], [{ created_at: '2020-01-01' }]])(
    'rejects client-supplied %j',
    async (extra) => {
      const res = await api().post('/api/accounts').send({ name: 'Mallory', ...extra });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details[0].message).toMatch(/Unknown field/);
    },
  );

  it.each([[{}], [{ name: '' }], [{ name: '   ' }], [{ name: 42 }], [{ name: 'x'.repeat(256) }]])(
    'rejects invalid name %j',
    async (body) => {
      const res = await api().post('/api/accounts').send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details[0].field).toBe('name');
    },
  );

  it('rejects a non-object body', async () => {
    const res = await api().post('/api/accounts').send([{ name: 'Alice' }]);
    expect(res.status).toBe(400);
  });

  it('returns INVALID_JSON for a malformed body', async () => {
    const res = await api().post('/api/accounts').set('Content-Type', 'application/json').send('{"name":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('returns PAYLOAD_TOO_LARGE for an oversized body', async () => {
    const res = await api().post('/api/accounts').send({ name: 'x'.repeat(20_000) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('GET /api/accounts/:id and /balance', () => {
  it('returns the account', async () => {
    const { id } = await newAccount('Bob');
    const res = await api().get(`/api/accounts/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id, name: 'Bob', balance: 0 });
  });

  it('returns account_id and balance', async () => {
    const { id } = await newAccount();
    const res = await api().get(`/api/accounts/${id}/balance`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ account_id: id, balance: 0 });
  });

  it('returns 404 ACCOUNT_NOT_FOUND for an unknown account', async () => {
    for (const path of [`/api/accounts/${MISSING_ID}`, `/api/accounts/${MISSING_ID}/balance`]) {
      const res = await api().get(path);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('ACCOUNT_NOT_FOUND');
    }
  });

  it('returns 400 for a malformed account id', async () => {
    const res = await api().get('/api/accounts/not-a-uuid/balance');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'VALIDATION_ERROR', details: [{ field: 'accountId' }] });
  });
});
