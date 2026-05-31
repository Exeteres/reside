# Error Style Guide

This document defines how custom errors must be implemented and used in ReSide replicas.

## General handling rules

- Catch and rethrow with context while preserving the original cause.
- Use `cause` to wrap errors instead of embedding messages.
- Keep errors capitalized without punctuation and surround identifiers with double quotes.

**GOOD:**

```typescript
try {
  const result = await riskyOperation();
  return result;
} catch (error) {
  throw new Error(`Failed to process operation "${operationId}"`, {
    cause: error,
  });
}
```

**BAD:**

```typescript
try {
  await operation();
} catch (error) {
  throw new Error(`Failed to update instance ${instanceId}: ${error.message}.`);
}
```

## Definitions placement

- Place replica-defined custom errors in `src/definitions/errors.ts`.
- Export them from `src/definitions/index.ts`.
- Import custom errors from `../definitions` (or `../../definitions`) instead of deep file paths.

## Error class construction rules

- Extend `ResideError` from `@reside/common/definitions` for all domain-level custom errors.
- Do not manually assign `this.name`.
- Accept error-specific fields through constructor arguments and mark these fields `readonly`.
- Build the final message in the error class constructor whenever possible.
- Keep message formatting deterministic and human-readable.

## Usage rules

- Throw custom error classes for expected domain failures.
- Avoid prefix-based message parsing for domain control flow.
- Keep unknown/unexpected failures as generic errors and handle them separately.

## Temporal-specific rules

- Do not throw `ApplicationFailure` manually from activities for normal domain errors.
- Throw custom `ResideError` subclasses from activities and configure workflow retry policy with class names.
- In workflow retry config, use `nonRetryableErrorTypes: [MyError.name]` entries from the same definitions module.
- In workflows, use `isResideError(error, MyError.name)` from `@reside/common/definitions` for domain error branching.
