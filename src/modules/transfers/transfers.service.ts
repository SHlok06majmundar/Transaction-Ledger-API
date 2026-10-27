import { PG_ERROR, pgConstraint, pgErrorCode, type Db, type Queryable } from '../../db/client.js';
import { errors } from '../../shared/errors.js';
import { ACCOUNT_COLUMNS, toAccount, type AccountRow } from '../accounts/accounts.model.js';
import { applyEntry, findByReference } from '../transactions/transactions.service.js';
import { TRANSFER_COLUMNS, toTransfer, type TransferRow } from './transfers.model.js';
import type { CreateTransferInput } from './transfers.schema.js';

async function findTransfer(db: Queryable, fromAccountId: string, referenceId: string) {
  const { rows } = await db.query<TransferRow>(
    `SELECT ${TRANSFER_COLUMNS} FROM transfers WHERE from_account_id = $1 AND reference_id = $2`,
    [fromAccountId, referenceId],
  );
  return rows[0] ? toTransfer(rows[0]) : null;
}

/**
 * Moves money between two accounts as one DB transaction:
 * transfer record + debit on source + credit on destination. Any failure rolls
 * back all three, so a partial transfer is impossible.
 */
export async function createTransfer(db: Db, input: CreateTransferInput) {
  const { from_account_id: fromId, to_account_id: toId } = input;

  try {
    return await db.transaction(async (tx) => {
      // Lock both rows in a fixed (id) order so two opposite transfers
      // (A->B and B->A) can't deadlock each other.
      const { rows } = await tx.query<AccountRow>(
        `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
        [[fromId, toId]],
      );
      const from = rows.find((r) => r.id === fromId);
      const to = rows.find((r) => r.id === toId);
      if (!from) throw errors.accountNotFound(fromId);
      if (!to) throw errors.accountNotFound(toId);

      const existingTransfer = await findTransfer(tx, fromId, input.reference_id);
      if (existingTransfer) throw errors.duplicateTransfer(existingTransfer);
      // The debit leg reuses the client's reference_id on the source account,
      // so it must not clash with a plain transaction there either.
      const existingTxn = await findByReference(tx, fromId, input.reference_id);
      if (existingTxn) throw errors.duplicateTransaction(existingTxn);

      const transferRes = await tx.query<TransferRow>(
        `INSERT INTO transfers (from_account_id, to_account_id, amount, description, reference_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING ${TRANSFER_COLUMNS}`,
        [fromId, toId, input.amount.toFixed(2), input.description ?? null, input.reference_id],
      );
      const transfer = toTransfer(transferRes.rows[0]);
      const description = input.description ?? null;

      const debit = await applyEntry(
        tx,
        { accountId: fromId, type: 'debit', amount: input.amount, description, referenceId: input.reference_id, transferId: transfer.id },
        toAccount(from).balance,
      );
      const credit = await applyEntry(
        tx,
        // transfer.id is unique, so this reference can never collide on the destination account.
        { accountId: toId, type: 'credit', amount: input.amount, description, referenceId: `transfer:${transfer.id}`, transferId: transfer.id },
        toAccount(to).balance,
      );

      return {
        transfer,
        debit_transaction: debit.transaction,
        credit_transaction: credit.transaction,
        balances: { [fromId]: debit.balance, [toId]: credit.balance },
      };
    });
  } catch (err) {
    if (pgErrorCode(err) === PG_ERROR.UNIQUE_VIOLATION) {
      const constraint = pgConstraint(err);
      if (constraint === 'transfers_from_reference_uniq') {
        throw errors.duplicateTransfer(await findTransfer(db, fromId, input.reference_id));
      }
      if (constraint === 'transactions_account_reference_uniq') {
        throw errors.duplicateTransaction(await findByReference(db, fromId, input.reference_id));
      }
    }
    throw err;
  }
}
