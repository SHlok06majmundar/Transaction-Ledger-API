import type { RequestParamHandler } from 'express';
import { errors } from '../shared/errors.js';
import { uuid } from '../shared/validation.js';

/** Malformed ids get a 400 here instead of reaching Postgres as an invalid uuid. */
export const validateUuidParam =
  (name: string): RequestParamHandler =>
  (_req, _res, next, value) => {
    if (!uuid.safeParse(value).success) {
      return next(errors.validation([{ field: name, message: 'must be a valid UUID' }], `Invalid ${name}`));
    }
    next();
  };
