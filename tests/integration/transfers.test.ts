import { describe, expect, it } from 'vitest';
import { MISSING_ID, setupTestApp } from '../helpers/testApp.js';

const { api, ref, txn, history, balanceOf, fundedAccount } = setupTestApp();

const transfer = (body: Record<string, unknown>) => api().post('/api/transfers').send(body);

describe('POST /api/transfers', () => {
  it('moves money atomically (A:100, B:50, transfer 30 -> A:70, B:80)', async () => {
    const [a, b] = await Promise.all([fundedAccount(100), fundedAccount(50)]);
    const res = await transfer({ from_account_id: a, to_account_id: b, amount: 30, reference_id: ref() });

    expect(res.status).toBe(201);
    expect(res.body.data.balances).toEqual({ [a]: 70, [b]: 80 });
    expect(res.body.data.debit_transaction).toMatchObject({ account_id: a, type: 'debit', amount: 30 });
    expect(res.body.data.credit_transaction).toMatchObject({ account_id: b, type: 'credit', amount: 30 });
    expect(res.body.data.debit_transaction.transfer_id).toBe(res.body.data.transfer.id);
    expect(await balanceOf(a)).toBe(70);
    expect(await balanceOf(b)).toBe(80);
  });

  it('rejects insufficient balance with no partial effect', async () => {
    const [a, b] = await Promise.all([fundedAccount(10), fundedAccount(0)]);
    const res = await transfer({ from_account_id: a, to_account_id: b, amount: 30, reference_id: ref() });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_BALANCE');
    expect(await balanceOf(a)).toBe(10);
    expect(await balanceOf(b)).toBe(0);
    expect((await history(b)).body.pagination.total_records).toBe(0);
  });

  it.each(['from', 'to'])('requires the %s account to exist', async (side) => {
    const a = await fundedAccount(100);
    const body =
      side === 'to'
        ? { from_account_id: a, to_account_id: MISSING_ID }
        : { from_account_id: MISSING_ID, to_account_id: a };
    const res = await transfer({ ...body, amount: 30, reference_id: ref() });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ACCOUNT_NOT_FOUND');
    expect(await balanceOf(a)).toBe(100);
  });

  it('rejects transfers to the same account', async () => {
    const a = await fundedAccount(100);
    const res = await transfer({ from_account_id: a, to_account_id: a, amount: 30, reference_id: ref() });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('to_account_id');
  });

  it('validates the body', async () => {
    const res = await transfer({ from_account_id: 'x', amount: -1 });
    expect(res.status).toBe(400);
    const fields = res.body.error.details.map((d: { field: string }) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['from_account_id', 'to_account_id', 'amount', 'reference_id']));
  });

  it('is idempotent on reference_id', async () => {
    const [a, b] = await Promise.all([fundedAccount(100), fundedAccount(0)]);
    const body = { from_account_id: a, to_account_id: b, amount: 30, reference_id: ref() };
    expect((await transfer(body)).status).toBe(201);

    const dup = await transfer(body);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_TRANSFER');
    expect(await balanceOf(a)).toBe(70);
    expect(await balanceOf(b)).toBe(30);
  });

  it('rejects a reference_id already used by a plain transaction on the source account', async () => {
    const [a, b] = await Promise.all([fundedAccount(100), fundedAccount(0)]);
    const reference_id = ref();
    await txn(a, { type: 'debit', amount: 1, reference_id });
    const res = await transfer({ from_account_id: a, to_account_id: b, amount: 30, reference_id });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_TRANSACTION');
    expect(await balanceOf(b)).toBe(0);
  });
});
