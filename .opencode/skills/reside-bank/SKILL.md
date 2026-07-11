---
name: reside-bank
description: Use when consuming or editing the bank replica API, bank commands, ∅ balances, bank transfers, payment requests, automatic payments, issue transactions, or bank idempotency semantics.
---

# Skill: reside-bank

# ReSide Bank API Rules

## When To Use

- Use when a replica reads balances from the bank replica.
- Use when a replica lists bank transactions.
- Use when a replica transfers the ∅ virtual currency.
- Use when a replica requests user payment or relies on automatic payment authorization.
- Use when code depends on bank idempotency or issue semantics.

## Hard Rules

- Treat `subject_id` values as canonical ReSide subjects, such as `telegram:1` or `replica:alpha`.
- Use the bank replica API instead of reading bank database tables from another replica.
- Send amounts as positive integer strings in ∅ units.
- Generate a deterministic RHID from the event that caused a replica transfer and pass it as the transfer idempotency key.
- Reusing an idempotency key must be treated as a successful retry when the bank API returns the original transaction.
- Do not create Operations for synchronous bank transfers.

## Payment Requests

- Payment request rejection is a completed business result, not an operation failure.
- When Bank rejects a payment request due to a `BankError`, surface that domain reason to the user and to API callers; reserve failed operations for unexpected/non-domain failures.
- Automatic payment authorization skips the interactive request, so integrations must still notify the payer when automatic payment is rejected.
- Callers that wait on Bank payment operations should wait for completion, then re-read the idempotent payment result; do not wait for success-only when rejected payment is a valid outcome.

## Permissions

- `BANK_ISSUE_REPLICA_FUNDS` allows issuing new ∅ funds to any replica account.
- Do not request or grant `BANK_ISSUE_REPLICA_FUNDS` for ordinary transfers.

## Review Checklist

- Balance reads and transaction listing handle lazily created empty accounts.
- Transfers use stable idempotency keys and do not derive them from wall-clock time.
- Payment integrations handle both interactive and automatic rejection paths.
- User-facing text uses `∅` for the currency symbol.
