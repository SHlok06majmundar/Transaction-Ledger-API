export interface TransferRow {
  id: string;
  from_account_id: string;
  to_account_id: string;
  amount: string;
  description: string | null;
  reference_id: string;
  created_at: Date;
}

export const TRANSFER_COLUMNS = 'id, from_account_id, to_account_id, amount, description, reference_id, created_at';

export const toTransfer = (r: TransferRow) => ({
  id: r.id,
  from_account_id: r.from_account_id,
  to_account_id: r.to_account_id,
  amount: Number(r.amount),
  description: r.description,
  reference_id: r.reference_id,
  created_at: r.created_at,
});

export type Transfer = ReturnType<typeof toTransfer>;
