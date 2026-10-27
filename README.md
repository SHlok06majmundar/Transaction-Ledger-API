# Transaction Ledger API

A backend API for a simple transaction ledger: create accounts, post credit/debit transactions, read balances and paginated history, and transfer money between accounts atomically.

**Stack:** Node.js · TypeScript · Express 5 · PostgreSQL (raw SQL via `pg`) · Zod · Vitest + Supertest

| Deliverable        | Where |
|--------------------|-------|
| Source code        | [`src/`](src/) |
| API documentation  | [`docs/API.md`](docs/API.md) · OpenAPI spec [`docs/openapi.yaml`](docs/openapi.yaml) · Swagger UI at `/docs` |
| Assumptions        | [`docs/ASSUMPTIONS.md`](docs/ASSUMPTIONS.md) |
| Tests              | [`tests/`](tests/) (111 tests: unit + integration) |

---

## Quick start

Requires **Node.js 18+** (developed on Node 24).

```bash
npm install
npm run dev          # http://localhost:3000   ·   Swagger UI: http://localhost:3000/docs
```

There is **no database to install**. With no `DATABASE_URL` set, the app runs an embedded PostgreSQL ([PGlite](https://pglite.dev), Postgres compiled to WASM) and stores data in `./data/pglite`. It's the same SQL, constraints and triggers as a real server.

### Using a real PostgreSQL / Supabase

```bash
cp .env.example .env
# set DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
# set DATABASE_SSL=true
npm run dev
```

The schema is created automatically on startup (idempotent, safe for several instances at once). You can also run it on its own with `npm run db:migrate`.

### Production build

```bash
npm run build && npm start
```

### Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start with hot reload |
| `npm run build` / `npm start` | Compile to `dist/` and run |
| `npm run db:migrate` | Apply schema only |
| `npm test` | All tests |
| `npm run test:unit` / `npm run test:integration` | One layer only |
| `npm run test:coverage` | Coverage report (`coverage/index.html`) |
| `npm run typecheck` | Type-check source **and** tests |

---

## Project structure

```
├── src/
│   ├── app.ts                    # Express app factory (no listen → testable)
│   ├── server.ts                 # Entry point: config → DB → migrate → listen
│   ├── config/env.ts             # Validated environment variables (fails fast)
│   ├── db/
│   │   ├── client.ts             # Db interface + pg / PGlite adapters, transaction helper
│   │   ├── schema.ts             # Tables, constraints, indexes, immutability triggers
│   │   └── migrate.ts            # `npm run db:migrate`
│   ├── middleware/
│   │   ├── errorHandler.ts       # Single place that turns errors into JSON responses
│   │   └── validateParams.ts     # UUID path-param validation
│   ├── modules/                  # Feature modules: routes → service → model
│   │   ├── accounts/             #   *.routes.ts   HTTP layer (parse input, set status)
│   │   ├── transactions/         #   *.service.ts  Business rules + SQL
│   │   └── transfers/            #   *.schema.ts   Zod request schemas
│   │                             #   *.model.ts    Row types + DB→API mappers
│   └── shared/
│       ├── errors.ts             # AppError + error catalogue (codes / statuses)
│       └── validation.ts         # Reusable validators (amount, uuid, …) + parse()
├── tests/
│   ├── helpers/testApp.ts        # Boots app on a fresh DB per file + API helpers
│   ├── unit/                     # Schemas and error handler, no DB
│   └── integration/              # HTTP → DB, one file per feature + integrity/concurrency
├── docs/                         # API.md, openapi.yaml, ASSUMPTIONS.md
├── requests.http                 # Click-to-run requests (VS Code REST Client)
└── .env.example
```

The **layering rule**: routes only handle HTTP (parse input, choose a status code). Services hold every business rule and all SQL. The database enforces the invariants a second time, so a bug in application code can't corrupt the ledger.

---

## How data integrity is guaranteed

| Requirement | How |
|---|---|
| **Atomicity** (balance update + transaction insert) | Both run inside one DB transaction (`db.transaction()`); any thrown error → `ROLLBACK`. |
| **No overdraft, even under concurrency** | `SELECT … FOR UPDATE` locks the account row; the debit is `UPDATE … SET balance = balance - $amt WHERE balance >= $amt`, so the check and the write are one statement. Backstop: `CHECK (balance >= 0)`. |
| **Duplicate `reference_id`** | Checked *after* taking the row lock (so concurrent retries wait and then see the first one), and backed by `UNIQUE (account_id, reference_id)`. A race that still reaches the constraint is translated to the same `409`. |
| **Immutability** | No PUT/PATCH/DELETE routes (they return `405`), **and** a DB trigger rejects every `UPDATE`/`DELETE` on `transactions` and `transfers`. |
| **Balance = sum of valid transactions** | Rejected operations throw before commit, so they leave no row and no balance change. A test checks `balance == SUM(credits) − SUM(debits)` directly. |
| **Exact money arithmetic** | `NUMERIC(18,2)` in Postgres; amounts are passed to SQL as strings, and all math happens in SQL. Test: `0.1 + 0.2 = 0.3`. |
| **Atomic transfers, no deadlocks** | One DB transaction writes the transfer record, debit leg and credit leg. Both account rows are locked in **id order**, so concurrent A→B and B→A transfers can't deadlock. |
| **Client can't set balance/id/timestamps** | Request schemas are `.strict()`, so unknown fields get a `400`. Values come from column defaults. |
| **Supabase hardening** | RLS is enabled on all tables (no policies), so they can't be reached through Supabase's public REST API with the anon key. The backend connects as the owner. |

---

## Testing

```bash
npm test                                   # embedded Postgres, no setup
TEST_DATABASE_URL=postgres://… npm test    # the same suite against a real PostgreSQL
```

* **Unit** (`tests/unit`): validation schemas (amount precision and limits, strict bodies, query coercion) and error-handler mapping.
* **Integration** (`tests/integration`): real HTTP requests via Supertest against a real database. Each file gets its own fresh DB. Covers every rule in the brief, plus:
  * concurrent debits never overdraw (10 parallel debits of 30 on a balance of 100 → exactly 3 succeed),
  * 8 parallel submissions of one `reference_id` → exactly one is applied,
  * opposite concurrent transfers → no deadlock and total money is conserved,
  * DB-level guarantees (trigger, CHECK, UNIQUE) verified by writing SQL directly, bypassing the API,
  * forced mid-transaction failure → balance change rolled back.

The suite passes on both embedded PGlite and **PostgreSQL 16** (verified with a real server and a 10-connection pool, which is where the concurrency tests really matter). Running against a real server also surfaced a migration race between parallel processes, now fixed with an advisory lock.

---

## Error format

Every error has the same shape:

```json
{ "error": { "code": "INSUFFICIENT_BALANCE", "message": "Insufficient balance for this debit",
             "details": { "balance": 100, "requested_amount": 150 } } }
```

| Status | Codes |
|---|---|
| 400 | `VALIDATION_ERROR`, `INVALID_JSON` |
| 404 | `ACCOUNT_NOT_FOUND`, `ROUTE_NOT_FOUND` |
| 405 | `TRANSACTION_IMMUTABLE` |
| 409 | `DUPLICATE_TRANSACTION`, `DUPLICATE_TRANSFER` |
| 413 | `PAYLOAD_TOO_LARGE` |
| 422 | `INSUFFICIENT_BALANCE`, `CONSTRAINT_VIOLATION` |
| 500 | `INTERNAL_ERROR` (no internals leaked) |

See [`docs/API.md`](docs/API.md) for every endpoint with examples.
