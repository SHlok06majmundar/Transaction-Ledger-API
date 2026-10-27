import type { Db, Queryable } from '../../db/client.js';
import { errors } from '../../shared/errors.js';
import { ACCOUNT_COLUMNS, toAccount, type AccountRow } from './accounts.model.js';
import type { CreateAccountInput } from './accounts.schema.js';

export async function createAccount(db: Db, input: CreateAccountInput) {
  // id, balance (0) and created_at all come from column defaults, never from the client.
  const { rows } = await db.query<AccountRow>(
    `INSERT INTO accounts (name) VALUES ($1) RETURNING ${ACCOUNT_COLUMNS}`,
    [input.name],
  );
  return toAccount(rows[0]);
}

export async function getAccount(db: Queryable, id: string) {
  const { rows } = await db.query<AccountRow>(`SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE id = $1`, [id]);
  if (!rows[0]) throw errors.accountNotFound(id);
  return toAccount(rows[0]);
}

export async function listAccounts(db: Db, limit = 100) {
  const { rows } = await db.query<AccountRow>(
    `SELECT ${ACCOUNT_COLUMNS} FROM accounts ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  return rows.map(toAccount);
}

export async function getBalance(db: Db, id: string) {
  const account = await getAccount(db, id);
  return { account_id: account.id, balance: account.balance };
}

/**
 * Row-locks the account for the rest of the surrounding DB transaction, so
 * concurrent writes to the same account are serialised.
 */
export async function lockAccount(tx: Queryable, id: string) {
  const { rows } = await tx.query<AccountRow>(
    `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE id = $1 FOR UPDATE`,
    [id],
  );
  if (!rows[0]) throw errors.accountNotFound(id);
  return toAccount(rows[0]);
}
