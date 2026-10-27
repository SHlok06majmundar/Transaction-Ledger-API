import { describe, expect, it } from 'vitest';
import { createAccountSchema } from '../../src/modules/accounts/accounts.schema.js';
import { createTransactionSchema, listTransactionsQuerySchema } from '../../src/modules/transactions/transactions.schema.js';
import { createTransferSchema } from '../../src/modules/transfers/transfers.schema.js';
import { AppError } from '../../src/shared/errors.js';
import { amount, parse } from '../../src/shared/validation.js';

describe('amount', () => {
  it.each([0.01, 1, 10.5, 99.99, 0.29, 1_000_000_000])('accepts %s', (v) => {
    expect(amount.safeParse(v).success).toBe(true);
  });

  it.each([0, -1, 0.001, 1.005, 1_000_000_000.01, Infinity, NaN, '10', null])('rejects %s', (v) => {
    expect(amount.safeParse(v).success).toBe(false);
  });
});

describe('createAccountSchema', () => {
  it('trims the name', () => {
    expect(createAccountSchema.parse({ name: '  Bob ' })).toEqual({ name: 'Bob' });
  });

  it('rejects unknown keys such as balance', () => {
    expect(createAccountSchema.safeParse({ name: 'Bob', balance: 10 }).success).toBe(false);
  });
});

describe('createTransactionSchema', () => {
  const valid = { type: 'credit', amount: 10, reference_id: 'R1' };

  it('accepts a minimal valid body and leaves description optional', () => {
    expect(createTransactionSchema.parse(valid)).toEqual(valid);
  });

  it('trims reference_id and rejects blank values', () => {
    expect(createTransactionSchema.parse({ ...valid, reference_id: ' R1 ' }).reference_id).toBe('R1');
    expect(createTransactionSchema.safeParse({ ...valid, reference_id: '  ' }).success).toBe(false);
  });
});

describe('listTransactionsQuerySchema', () => {
  it('applies defaults', () => {
    expect(listTransactionsQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
  });

  it('coerces numeric strings', () => {
    expect(listTransactionsQuerySchema.parse({ page: '3', limit: '50', type: 'debit' })).toEqual({
      page: 3,
      limit: 50,
      type: 'debit',
    });
  });

  it.each([{ page: '0' }, { page: 'x' }, { limit: '101' }, { limit: '1.5' }, { page: ['1', '2'] }, { type: 'all' }])(
    'rejects %j',
    (q) => {
      expect(listTransactionsQuerySchema.safeParse(q).success).toBe(false);
    },
  );
});

describe('createTransferSchema', () => {
  const a = '11111111-1111-4111-8111-111111111111';
  const b = '22222222-2222-4222-8222-222222222222';

  it('rejects identical source and destination', () => {
    const r = createTransferSchema.safeParse({ from_account_id: a, to_account_id: a, amount: 1, reference_id: 'T' });
    expect(r.success).toBe(false);
  });

  it('accepts distinct accounts', () => {
    const r = createTransferSchema.safeParse({ from_account_id: a, to_account_id: b, amount: 1, reference_id: 'T' });
    expect(r.success).toBe(true);
  });
});

describe('parse()', () => {
  it('throws a 400 AppError listing every invalid field', () => {
    try {
      parse(createTransactionSchema, { type: 'x', amount: -1 });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const e = err as AppError;
      expect(e.status).toBe(400);
      expect(e.code).toBe('VALIDATION_ERROR');
      expect((e.details as { field: string }[]).map((d) => d.field)).toEqual(['type', 'amount', 'reference_id']);
    }
  });

  it('reports unknown keys by name', () => {
    expect(() => parse(createAccountSchema, { name: 'A', balance: 5 })).toThrow(AppError);
    try {
      parse(createAccountSchema, { name: 'A', balance: 5 });
    } catch (err) {
      expect((err as AppError).details).toEqual([{ field: null, message: 'Unknown field(s): balance' }]);
    }
  });
});
