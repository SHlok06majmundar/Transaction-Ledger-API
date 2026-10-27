export type TransactionType = 'credit' | 'debit';

export interface TransactionRow {
  id: string;
  account_id: string;
  type: TransactionType;
  amount: string;
  description: string | null;
  reference_id: string;
  transfer_id: string | null;
  created_at: Date;
}

export const TRANSACTION_COLUMNS = 'id, account_id, type, amount, description, reference_id, transfer_id, created_at';

export const toTransaction = (r: TransactionRow) => ({
  id: r.id,
  account_id: r.account_id,
  type: r.type,
  amount: Number(r.amount),
  description: r.description,
  reference_id: r.reference_id,
  transfer_id: r.transfer_id,
  created_at: r.created_at,
});

export type Transaction = ReturnType<typeof toTransaction>;
