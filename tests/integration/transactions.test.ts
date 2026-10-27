import { describe, expect, it } from 'vitest';
import { MISSING_ID, setupTestApp } from '../helpers/testApp.js';

const { ref, newAccount, txn, history, balanceOf, fundedAccount } = setupTestApp();

describe('Credit and debit', () => {
  it('credit increases and debit decreases the balance', async () => {
    const id = await fundedAccount(100);

    const credit = await txn(id, { type: 'credit', amount: 50, description: 'Salary', reference_id: ref() });
    expect(credit.status).toBe(201);
    expect(credit.body.data).toMatchObject({ account_id: id, type: 'credit', amount: 50, description: 'Salary' });
    expect(credit.body.meta.balance).toBe(150);

    const debit = await txn(id, { type: 'debit', amount: 30, reference_id: ref() });
    expect(debit.status).toBe(201);
    expect(debit.body.meta.balance).toBe(120);
    expect(await balanceOf(id)).toBe(120);
  });

  it('returns every field the brief requires', async () => {
    const { id } = await newAccount();
    const res = await txn(id, { type: 'credit', amount: 1, description: 'x', reference_id: 'R-1' });
    expect(Object.keys(res.body.data)).toEqual(
      expect.arrayContaining(['id', 'account_id', 'type', 'amount', 'description', 'reference_id', 'created_at']),
    );
  });

  it('rejects a debit larger than the balance (100 - 150) and leaves balance at 100', async () => {
    const id = await fundedAccount(100);

    const res = await txn(id, { type: 'debit', amount: 150, reference_id: ref() });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({
      code: 'INSUFFICIENT_BALANCE',
      details: { balance: 100, requested_amount: 150 },
    });
    expect(await balanceOf(id)).toBe(100);
    expect((await history(id)).body.pagination.total_records).toBe(1);
  });

  it('allows debiting the exact balance down to zero', async () => {
    const id = await fundedAccount(10.25);
    expect((await txn(id, { type: 'debit', amount: 10.25, reference_id: ref() })).status).toBe(201);
    expect(await balanceOf(id)).toBe(0);
  });

  it('keeps decimal arithmetic exact (0.1 + 0.2 = 0.3)', async () => {
    const { id } = await newAccount();
    await txn(id, { type: 'credit', amount: 0.1, reference_id: ref() });
    await txn(id, { type: 'credit', amount: 0.2, reference_id: ref() });
    expect(await balanceOf(id)).toBe(0.3);
  });

  it('returns 404 for an unknown account and 400 for a malformed id', async () => {
    const missing = await txn(MISSING_ID, { type: 'credit', amount: 1, reference_id: ref() });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('ACCOUNT_NOT_FOUND');

    const malformed = await txn('not-a-uuid', { type: 'credit', amount: 1, reference_id: ref() });
    expect(malformed.status).toBe(400);
  });
});

describe('Transaction validation', () => {
  it.each([
    ['invalid type', { type: 'refund', amount: 10 }, 'type'],
    ['missing type', { amount: 10 }, 'type'],
    ['missing amount', { type: 'credit' }, 'amount'],
    ['zero amount', { type: 'credit', amount: 0 }, 'amount'],
    ['negative amount', { type: 'credit', amount: -5 }, 'amount'],
    ['string amount', { type: 'credit', amount: '10' }, 'amount'],
    ['3 decimal places', { type: 'credit', amount: 1.005 }, 'amount'],
    ['amount above max', { type: 'credit', amount: 1e12 }, 'amount'],
    ['unknown field', { type: 'credit', amount: 10, balance: 5 }, null],
  ])('rejects %s', async (_label, body, field) => {
    const { id } = await newAccount();
    const res = await txn(id, { reference_id: ref(), ...body });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d: { field: string | null }) => d.field)).toContain(field);
    expect(await balanceOf(id)).toBe(0);
  });

  it.each([[{}], [{ reference_id: '' }], [{ reference_id: '   ' }], [{ reference_id: 123 }]])(
    'requires reference_id %j',
    async (extra) => {
      const { id } = await newAccount();
      const res = await txn(id, { type: 'credit', amount: 10, ...extra });
      expect(res.status).toBe(400);
      expect(res.body.error.details[0].field).toBe('reference_id');
    },
  );
});

describe('Duplicate reference_id', () => {
  it('does not create a second transaction or change the balance', async () => {
    const { id } = await newAccount();
    const reference_id = ref();
    const first = await txn(id, { type: 'credit', amount: 100, reference_id });
    expect(first.status).toBe(201);

    const dup = await txn(id, { type: 'credit', amount: 100, reference_id });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_TRANSACTION');
    expect(dup.body.error.details.existing_transaction.id).toBe(first.body.data.id);

    // Different payload, same reference: still a duplicate.
    expect((await txn(id, { type: 'debit', amount: 5, reference_id })).status).toBe(409);

    expect(await balanceOf(id)).toBe(100);
    expect((await history(id)).body.pagination.total_records).toBe(1);
  });

  it('allows the same reference_id on different accounts', async () => {
    const [a, b] = await Promise.all([newAccount(), newAccount()]);
    const reference_id = ref();
    expect((await txn(a.id, { type: 'credit', amount: 10, reference_id })).status).toBe(201);
    expect((await txn(b.id, { type: 'credit', amount: 10, reference_id })).status).toBe(201);
  });

  it('a rejected debit does not consume its reference_id', async () => {
    const id = await fundedAccount(10);
    const reference_id = ref();
    expect((await txn(id, { type: 'debit', amount: 50, reference_id })).status).toBe(422);
    await txn(id, { type: 'credit', amount: 100, reference_id: ref() });
    expect((await txn(id, { type: 'debit', amount: 50, reference_id })).status).toBe(201);
  });
});
