---
name: reside-testing
description: Use when adding or editing tests, business feature coverage, Bun test assertions, async matchers, deep mocks, Prisma-backed checks, or replica e2e scenarios.
enforcement:
  files:
    - "**/*.test.ts"
    - "**/*.spec.ts"
    - "replicas/*/src/e2e/**"
---

# ReSide Testing Rules

## Business Feature Coverage

For business feature changes, write new tests or update existing tests to cover changed behavior when it is reasonable.

## Async Matchers

Do not use `await` before `expect(...).rejects` or `expect(...).resolves`.

Good:

```typescript
test("throws for invalid id", () => {
  expect(loadById("bad")).rejects.toThrow("invalid id");
});
```

Bad:

```typescript
test("throws for invalid id", async () => {
  await expect(loadById("bad")).rejects.toThrow("invalid id");
});
```

## Test Callback Async Usage

Mark a test callback as `async` only when it contains real `await` usage for non-matcher promises.
If the callback has no real `await` after removing matcher-await patterns, make the callback synchronous.

Good:

```typescript
test("rejects for invalid input", () => {
  expect(doWork("bad")).rejects.toThrow("invalid input");
});

test("returns mapped data", async () => {
  const result = await doWork("ok");
  expect(result).toEqual({ value: 1 });
});
```

## Deep Mock Call Assertions

When using deep mock helpers from `@reside/common/testing`, assert method calls through spy handles.

Good:

```typescript
expect(prisma.permission.findMany.spy()).toHaveBeenCalledTimes(1);
expect(operationService.toApiOperation.spy()).toHaveBeenCalledWith(77);
```

## Assertion Strictness

Avoid brittle full-object equality checks when the object type includes extra generated fields such as Prisma records or generated API payloads.
Prefer property-level assertions for the behavior under test.

Good:

```typescript
expect(result.operation?.id).toBe(88);
expect(result).toHaveProperty("operation");
```

## Branch Coverage Expectations

Business tests should cover both:

- input and validation failures;
- key execution branches and side effects.

For request/operation flows, include cases for:

- immediate resolution when existing data already satisfies the request;
- reusing an existing pending operation when request payload matches;
- creating a new operation and invoking side effects when no reusable operation exists.

## E2E Pattern

- Keep replica e2e scenarios in `src/e2e/*` and orchestrate from `src/e2e/main.ts`.
- E2E entry must set up required fixtures, run checks, and always clean up in `finally`.
- Every database entity created by e2e directly or indirectly must be deleted during cleanup in the same run.
- Cleanup must be deterministic and idempotent, and must not leave residual records after successful or failed test execution.
- E2E must not mutate pre-existing non-e2e data.
- E2E fixtures must use per-run unique identifiers and names to avoid collisions with real records.
- If an API check must touch a singleton or shared entity, e2e must snapshot its original state and restore it fully in cleanup.
- Long-lived e2e permission grants may be kept intentionally without cleanup to avoid interactive approval prompts in repeated e2e runs.
- The long-lived e2e permission grant exception applies only to permission grants used by e2e and must be documented in the corresponding e2e module.
- E2E should exercise public API/contracts rather than internal implementation details.
