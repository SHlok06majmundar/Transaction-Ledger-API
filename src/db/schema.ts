/**
 * Database schema. Idempotent, so it is safe to run on every startup.
 *
 * Integrity is enforced by the database itself, not only by application code:
 *  - balance can never go negative             (CHECK balance >= 0)
 *  - amounts must be positive                  (CHECK amount > 0)
 *  - type is credit | debit                    (CHECK type IN ...)
 *  - reference_id is unique per account        (UNIQUE (account_id, reference_id))
 *  - transactions are append-only              (trigger rejects UPDATE / DELETE)
 *  - accounts with history cannot be removed   (FK ... ON DELETE RESTRICT)
 */
export const SCHEMA_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS accounts (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT          NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 255),
  balance     NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transfers (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  from_account_id  UUID          NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  to_account_id    UUID          NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  amount           NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  description      TEXT,
  reference_id     TEXT          NOT NULL CHECK (length(btrim(reference_id)) > 0),
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT transfers_distinct_accounts CHECK (from_account_id <> to_account_id),
  CONSTRAINT transfers_from_reference_uniq UNIQUE (from_account_id, reference_id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID          NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  type          TEXT          NOT NULL CHECK (type IN ('credit', 'debit')),
  amount        NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  description   TEXT,
  reference_id  TEXT          NOT NULL CHECK (length(btrim(reference_id)) > 0),
  transfer_id   UUID          REFERENCES transfers(id) ON DELETE RESTRICT,
  -- clock_timestamp() (not now()) so rows written later inside a long-running
  -- DB transaction still sort after rows committed before them.
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT transactions_account_reference_uniq UNIQUE (account_id, reference_id)
);

-- Serves "history for account, optionally by type, latest first".
CREATE INDEX IF NOT EXISTS transactions_account_created_idx
  ON transactions (account_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS transactions_account_type_created_idx
  ON transactions (account_id, type, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION forbid_transaction_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'transactions are immutable (% not allowed)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER transactions_immutable
  BEFORE UPDATE OR DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION forbid_transaction_mutation();

CREATE OR REPLACE TRIGGER transfers_immutable
  BEFORE UPDATE OR DELETE ON transfers
  FOR EACH ROW EXECUTE FUNCTION forbid_transaction_mutation();

-- On Supabase, tables in "public" are reachable through the auto-generated REST
-- API with the anon key. RLS with no policies closes that door; this backend
-- connects as the table owner, which bypasses RLS.
ALTER TABLE accounts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfers    ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
`;
