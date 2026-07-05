---
name: reside-bank
description: Use when consuming the bank replica API, bank commands, ∅ balances, bank transfers, issue transactions, or bank idempotency semantics.
---

# Skill: reside-bank

# ReSide Bank API Rules

## When To Use

- Use when a replica reads balances from the bank replica.
- Use when a replica lists bank transactions.
- Use when a replica transfers the ∅ virtual currency.
- Use when code depends on bank idempotency or issue semantics.

## Hard Rules

- Treat `subject_id` values as canonical ReSide subjects, such as `telegram:1` or `replica:alpha`.
- Use the bank replica API instead of reading bank database tables from another replica.
- Send amounts as positive integer strings in ∅ units.
- Generate a deterministic RHID from the event that caused a replica transfer and pass it as the transfer idempotency key.
- Reusing an idempotency key must be treated as a successful retry when the bank API returns the original transaction.
- Do not create Operations for synchronous bank transfers.

## Permissions

- `BANK_ISSUE_REPLICA_FUNDS` allows issuing new ∅ funds to any replica account.
- Do not request or grant `BANK_ISSUE_REPLICA_FUNDS` for ordinary transfers.

## Review Checklist

- Balance reads and transaction listing handle lazily created empty accounts.
- Transfers use stable idempotency keys and do not derive them from wall-clock time.
- User-facing text uses `∅` for the currency symbol.
