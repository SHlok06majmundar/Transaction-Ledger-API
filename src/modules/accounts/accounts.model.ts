// Postgres returns NUMERIC as a string to avoid float loss. All arithmetic
// happens in SQL; we only convert to a JS number at the API boundary.

export interface AccountRow {
  id: string;
  name: string;
  balance: string;
  created_at: Date;
}

export const ACCOUNT_COLUMNS = 'id, name, balance, created_at';

export const toAccount = (r: AccountRow) => ({
  id: r.id,
  name: r.name,
  balance: Number(r.balance),
  created_at: r.created_at,
});

export type Account = ReturnType<typeof toAccount>;
