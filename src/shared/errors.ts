/** Every error the API returns has the shape { error: { code, message, details? } }. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const errors = {
  validation: (details: unknown, message = 'Request validation failed') =>
    new AppError(400, 'VALIDATION_ERROR', message, details),
  invalidJson: () => new AppError(400, 'INVALID_JSON', 'Request body is not valid JSON'),
  accountNotFound: (id: string) => new AppError(404, 'ACCOUNT_NOT_FOUND', `Account ${id} not found`),
  routeNotFound: (method: string, path: string) =>
    new AppError(404, 'ROUTE_NOT_FOUND', `No route for ${method} ${path}`),
  immutable: () =>
    new AppError(405, 'TRANSACTION_IMMUTABLE', 'Transactions cannot be modified or deleted once created'),
  duplicateTransaction: (transaction: unknown) =>
    new AppError(
      409,
      'DUPLICATE_TRANSACTION',
      'A transaction with this reference_id already exists for this account',
      { existing_transaction: transaction },
    ),
  duplicateTransfer: (transfer: unknown) =>
    new AppError(409, 'DUPLICATE_TRANSFER', 'A transfer with this reference_id already exists for the source account', {
      existing_transfer: transfer,
    }),
  insufficientBalance: (balance: number, requested: number) =>
    new AppError(422, 'INSUFFICIENT_BALANCE', 'Insufficient balance for this debit', {
      balance,
      requested_amount: requested,
    }),
};
