import { z } from 'zod';
import { errors } from './errors.js';

export const MAX_AMOUNT = 1_000_000_000;

const hasAtMostTwoDecimals = (v: number) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6;

export const uuid = z.uuid({ error: 'must be a valid UUID' });

export const amount = z
  .number({ error: 'amount must be a number' })
  .finite()
  .gt(0, 'amount must be greater than 0')
  .max(MAX_AMOUNT, `amount must not exceed ${MAX_AMOUNT}`)
  .refine(hasAtMostTwoDecimals, 'amount must have at most 2 decimal places');

export const referenceId = z
  .string({ error: 'reference_id is required' })
  .trim()
  .min(1, 'reference_id is required')
  .max(100, 'reference_id must be at most 100 characters');

export const description = z.string().trim().max(255, 'description must be at most 255 characters').optional();

/** Query-string integer >= 1. Rejects "abc", "1.5", "-1", "" and repeated params. */
export const positiveIntParam = (name: string) =>
  z
    .string({ error: `${name} must be a positive integer` })
    .regex(/^\d+$/, `${name} must be a positive integer`)
    .transform(Number)
    .pipe(z.number().int().min(1, `${name} must be at least 1`));

/** Parses input or throws a 400 with per-field messages. */
export function parse<S extends z.ZodType>(schema: S, input: unknown, what = 'Request body'): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const fields = result.error.issues.map((i) => ({
      field: i.path.join('.') || null,
      message: i.code === 'unrecognized_keys' ? `Unknown field(s): ${i.keys.join(', ')}` : i.message,
    }));
    throw errors.validation(fields, `${what} is invalid`);
  }
  return result.data;
}
