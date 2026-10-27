import { PG_ERROR, pgConstraint, pgErrorCode, type Db, type Queryable } from '../../db/client.js';
import { errors } from '../../shared/errors.js';
import { getAccount, lockAccount } from '../accounts/accounts.service.js';
import { TRANSACTION_COLUMNS, toTransaction, type TransactionRow, type TransactionType } from './transactions.model.js';
import type { CreateTransactionInput, ListTransactionsQuery } from './transactions.schema.js';

export interface LedgerEntry {
  accountId: string;
  type: TransactionType;
  amount: number;
  description?: string | null;
  referenceId: string;
  transferId?: string;
}

export async function findByReference(db: Queryable, accountId: string, referenceId: string) {
  const { rows } = await db.query<TransactionRow>(
    `SELECT ${TRANSACTION_COLUMNS} FROM transactions WHERE account_id = $1 AND reference_id = $2`,
    [accountId, referenceId],
  );
  return rows[0] ? toTransaction(rows[0]) : null;
}

/**
 * Applies one ledger entry inside an already-open DB transaction:
 * moves the balance and appends the transaction row. The caller must hold the
 * account's row lock (see lockAccount) and owns COMMIT / ROLLBACK, so the two
 * writes are persisted together or not at all.
 */
export async function applyEntry(tx: Queryable, entry: LedgerEntry, currentBalance: number) {
  const amount = entry.amount.toFixed(2); // pass as string so NUMERIC math stays exact
  const delta = entry.type === 'credit' ? '+' : '-';

  // The "balance >= amount" guard makes the debit check part of the write itself.
  const updated = await tx.query<{ balance: string }>(
    `UPDATE accounts SET balance = balance ${delta} $2
      WHERE id = $1 AND ($3 = 'credit' OR balance >= $2)
      RETURNING balance`,
    [entry.accountId, amount, entry.type],
  );
  if (!updated.rows[0]) throw errors.insufficientBalance(currentBalance, entry.amount);

  const { rows } = await tx.query<TransactionRow>(
    `INSERT INTO transactions (account_id, type, amount, description, reference_id, transfer_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${TRANSACTION_COLUMNS}`,
    [entry.accountId, entry.type, amount, entry.description ?? null, entry.referenceId, entry.transferId ?? null],
  );
  return { transaction: toTransaction(rows[0]), balance: Number(updated.rows[0].balance) };
}

export async function createTransaction(db: Db, accountId: string, input: CreateTransactionInput) {
  try {
    return await db.transaction(async (tx) => {
      const account = await lockAccount(tx, accountId);

      // Checked after taking the lock, so a concurrent retry of the same
      // reference_id waits here and then sees the first one.
      const existing = await findByReference(tx, accountId, input.reference_id);
      if (existing) throw errors.duplicateTransaction(existing);

      return applyEntry(
        tx,
        {
          accountId,
          type: input.type,
          amount: input.amount,
          description: input.description,
          referenceId: input.reference_id,
        },
        account.balance,
      );
    });
  } catch (err) {
    // Safety net: the UNIQUE constraint is the final authority on duplicates.
    if (pgErrorCode(err) === PG_ERROR.UNIQUE_VIOLATION && pgConstraint(err) === 'transactions_account_reference_uniq') {
      const existing = await findByReference(db, accountId, input.reference_id);
      throw errors.duplicateTransaction(existing);
    }
    throw err;
  }
}

export async function listTransactions(db: Db, accountId: string, q: ListTransactionsQuery) {
  await getAccount(db, accountId); // 404 for unknown accounts instead of an empty list

  const params: unknown[] = [accountId];
  let where = 'account_id = $1';
  if (q.type) {
    params.push(q.type);
    where += ` AND type = $${params.length}`;
  }

  const countRes = await db.query<{ count: string | number }>(
    `SELECT count(*) AS count FROM transactions WHERE ${where}`,
    params,
  );
  const totalRecords = Number(countRes.rows[0].count);

  const offset = (q.page - 1) * q.limit;
  const { rows } = await db.query<TransactionRow>(
    `SELECT ${TRANSACTION_COLUMNS} FROM transactions WHERE ${where}
      ORDER BY created_at DESC, id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, q.limit, offset],
  );

  const totalPages = Math.ceil(totalRecords / q.limit);
  return {
    data: rows.map(toTransaction),
    pagination: {
      page: q.page,
      limit: q.limit,
      total_records: totalRecords,
      total_pages: totalPages,
      has_next_page: q.page < totalPages,
      has_previous_page: q.page > 1,
    },
    filters: { type: q.type ?? null },
  };
}
