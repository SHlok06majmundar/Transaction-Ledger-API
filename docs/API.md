# API Reference

Base URL: `http://localhost:3000` · Interactive docs: `/docs` · Machine-readable spec: [`openapi.yaml`](openapi.yaml) (also served at `/openapi.json`)

**Conventions**
- Request and response bodies are JSON. Successful responses wrap the payload in `data`.
- Errors are always `{ "error": { "code", "message", "details?" } }`.
- IDs are UUIDs. A malformed id → `400 VALIDATION_ERROR`; a well-formed but unknown id → `404 ACCOUNT_NOT_FOUND`.
- `amount` is a JSON number, `> 0`, `≤ 1,000,000,000`, at most 2 decimal places.
- Timestamps are ISO-8601 UTC.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/accounts` | Create account |
| GET | `/api/accounts` | List accounts (latest 100) |
| GET | `/api/accounts/{accountId}` | Get account |
| GET | `/api/accounts/{accountId}/balance` | Get balance |
| POST | `/api/accounts/{accountId}/transactions` | Add credit / debit |
| GET | `/api/accounts/{accountId}/transactions` | History (filter, paginate, latest first) |
| POST | `/api/transfers` | Transfer between accounts (bonus) |
| GET | `/health` | Liveness + DB check |

---

## 1. Create account

`POST /api/accounts`

```json
{ "name": "Alice" }
```

**201 Created**
```json
{
  "data": {
    "id": "250f6b38-7f3e-4022-8c88-07f6f6bdc053",
    "name": "Alice",
    "balance": 0,
    "created_at": "2026-10-27T08:57:46.400Z"
  }
}
```

| Case | Status | Code |
|---|---|---|
| `name` missing / blank / not a string / > 255 chars | 400 | `VALIDATION_ERROR` |
| Any other field sent (`balance`, `id`, `created_at`, …) | 400 | `VALIDATION_ERROR` (`Unknown field(s): balance`) |
| Malformed JSON | 400 | `INVALID_JSON` |

---

## 2. Add transaction

`POST /api/accounts/{accountId}/transactions`

```json
{ "type": "credit", "amount": 50, "description": "Salary", "reference_id": "INV-1001" }
```

| Field | Rules |
|---|---|
| `type` | required, `credit` or `debit` |
| `amount` | required, number, `0 < amount ≤ 1e9`, ≤ 2 decimals |
| `reference_id` | required, non-blank string ≤ 100 chars, unique **per account** |
| `description` | optional string ≤ 255 chars |

**201 Created**
```json
{
  "data": {
    "id": "54ba3cce-f025-4d1b-85d9-042789c09efc",
    "account_id": "250f6b38-7f3e-4022-8c88-07f6f6bdc053",
    "type": "credit",
    "amount": 50,
    "description": "Salary",
    "reference_id": "INV-1001",
    "transfer_id": null,
    "created_at": "2026-10-27T08:57:46.468Z"
  },
  "meta": { "balance": 150 }
}
```
`meta.balance` is the account balance right after this transaction. `transfer_id` is set only when the entry is one leg of a transfer.

**Errors**

| Case | Status | Code |
|---|---|---|
| Invalid type / amount / missing reference_id / unknown field | 400 | `VALIDATION_ERROR` |
| Account does not exist | 404 | `ACCOUNT_NOT_FOUND` |
| `reference_id` already used on this account | 409 | `DUPLICATE_TRANSACTION`. `details.existing_transaction` holds the original. Nothing is created and the balance doesn't change. |
| Debit greater than balance | 422 | `INSUFFICIENT_BALANCE`. `details: { balance, requested_amount }`. Balance unchanged. |

```json
{
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "Insufficient balance for this debit",
    "details": { "balance": 100, "requested_amount": 150 }
  }
}
```

---

## 3. Get balance

`GET /api/accounts/{accountId}/balance`

**200 OK**
```json
{ "data": { "account_id": "250f6b38-7f3e-4022-8c88-07f6f6bdc053", "balance": 70 } }
```
Unknown account → `404 ACCOUNT_NOT_FOUND`.

---

## 4. Transaction history

`GET /api/accounts/{accountId}/transactions?type=credit&page=1&limit=20`

| Query | Default | Rules |
|---|---|---|
| `type` | both | `credit` or `debit` |
| `page` | `1` | integer ≥ 1 |
| `limit` | `20` | integer 1–100 |

Sorted **latest first** by `created_at` (ties broken by `id` so pages are stable).

**200 OK**
```json
{
  "data": [ { "id": "…", "type": "credit", "amount": 100, "reference_id": "INV-1", "created_at": "…" } ],
  "pagination": {
    "page": 2,
    "limit": 1,
    "total_records": 2,
    "total_pages": 2,
    "has_next_page": false,
    "has_previous_page": true
  },
  "filters": { "type": null }
}
```

- A page past the end returns `200` with `data: []` (and correct totals).
- Invalid `page`/`limit`/`type` (e.g. `page=0`, `limit=101`, `limit=2.5`, `type=refund`, repeated params) → `400 VALIDATION_ERROR`.
- Unknown account → `404 ACCOUNT_NOT_FOUND`.

---

## 5. Immutability

There are no endpoints to edit or delete transactions. `PUT`, `PATCH` or `DELETE` on `/api/accounts/{id}/transactions[/{txnId}]` returns:

```json
{ "error": { "code": "TRANSACTION_IMMUTABLE", "message": "Transactions cannot be modified or deleted once created" } }
```
with status **405**. A database trigger also rejects `UPDATE`/`DELETE` on the table itself.

---

## 6. Transfer (bonus)

`POST /api/transfers`

```json
{
  "from_account_id": "250f6b38-…",
  "to_account_id": "e4b53107-…",
  "amount": 30,
  "description": "Rent share",
  "reference_id": "TRF-001"
}
```

**201 Created**
```json
{
  "data": {
    "transfer": { "id": "…", "from_account_id": "…", "to_account_id": "…", "amount": 30, "reference_id": "TRF-001", "created_at": "…" },
    "debit_transaction":  { "account_id": "250f6b38-…", "type": "debit",  "amount": 30, "reference_id": "TRF-001", "transfer_id": "…" },
    "credit_transaction": { "account_id": "e4b53107-…", "type": "credit", "amount": 30, "reference_id": "transfer:<transfer id>", "transfer_id": "…" },
    "balances": { "250f6b38-…": 70, "e4b53107-…": 80 }
  }
}
```

The transfer record and both ledger entries are written in **one** DB transaction, so any failure rolls back all of them.

| Case | Status | Code |
|---|---|---|
| Validation error, or `from == to` | 400 | `VALIDATION_ERROR` |
| Either account missing | 404 | `ACCOUNT_NOT_FOUND` |
| Same `reference_id` already used for a transfer from this source | 409 | `DUPLICATE_TRANSFER` |
| `reference_id` already used by a normal transaction on the source | 409 | `DUPLICATE_TRANSACTION` |
| Source balance too low | 422 | `INSUFFICIENT_BALANCE` |

---

## Quick curl walkthrough

```bash
B=http://localhost:3000/api
curl -s -X POST $B/accounts -H 'content-type: application/json' -d '{"name":"Alice"}'
# → copy data.id into A
curl -s -X POST $B/accounts/$A/transactions -H 'content-type: application/json' \
     -d '{"type":"credit","amount":100,"reference_id":"INV-1"}'
curl -s $B/accounts/$A/balance
curl -s "$B/accounts/$A/transactions?type=credit&page=1&limit=10"
```

A ready-to-run collection is in [`../requests.http`](../requests.http).
