import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../../src/middleware/errorHandler.js';
import { AppError, errors } from '../../src/shared/errors.js';

function run(err: unknown) {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  errorHandler(err, {} as Request, res as unknown as Response, vi.fn());
  return { status: res.status.mock.calls[0][0], body: res.json.mock.calls[0][0] };
}

describe('errorHandler', () => {
  it('serialises AppError with details', () => {
    const { status, body } = run(errors.insufficientBalance(100, 150));
    expect(status).toBe(422);
    expect(body).toEqual({
      error: {
        code: 'INSUFFICIENT_BALANCE',
        message: 'Insufficient balance for this debit',
        details: { balance: 100, requested_amount: 150 },
      },
    });
  });

  it('omits details when there are none', () => {
    const { body } = run(new AppError(404, 'X', 'nope'));
    expect(body).toEqual({ error: { code: 'X', message: 'nope' } });
  });

  it('maps body-parser errors', () => {
    expect(run({ type: 'entity.parse.failed' }).body.error.code).toBe('INVALID_JSON');
    expect(run({ type: 'entity.too.large' }).status).toBe(413);
  });

  it('maps a Postgres CHECK violation to 422', () => {
    expect(run({ code: '23514' })).toMatchObject({ status: 422, body: { error: { code: 'CONSTRAINT_VIOLATION' } } });
  });

  it('hides internals of unexpected errors', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { status, body } = run(new Error('secret stack detail'));
    expect(status).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(body)).not.toContain('secret');
    spy.mockRestore();
  });
});
