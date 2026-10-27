import type { ErrorRequestHandler, RequestHandler } from 'express';
import { PG_ERROR, pgErrorCode } from '../db/client.js';
import { AppError, errors } from '../shared/errors.js';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(errors.routeNotFound(req.method, req.path));
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  let appError: AppError;

  if (err instanceof AppError) {
    appError = err;
  } else if (err?.type === 'entity.parse.failed') {
    appError = errors.invalidJson();
  } else if (err?.type === 'entity.too.large') {
    appError = new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  } else if (pgErrorCode(err) === PG_ERROR.CHECK_VIOLATION) {
    // Should be unreachable (validation runs first) but the DB constraint is the last line of defence.
    appError = new AppError(422, 'CONSTRAINT_VIOLATION', 'The operation violates a data integrity rule');
  } else {
    console.error(err);
    appError = new AppError(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
  }

  res.status(appError.status).json({
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details !== undefined && { details: appError.details }),
    },
  });
};
