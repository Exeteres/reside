# TypeScript Testing Guide

This document defines testing conventions for ReSide TypeScript code.

## Async Matchers

Do not use `await` before `expect(...).rejects` or `expect(...).resolves`.

**GOOD:**

```typescript
test("throws for invalid id", () => {
  expect(loadById("bad")).rejects.toThrow("invalid id");
});
```

**BAD:**

```typescript
test("throws for invalid id", async () => {
  await expect(loadById("bad")).rejects.toThrow("invalid id");
});
```

## Test Callback Async Usage

Mark a test callback as `async` only when it contains real `await` usage for non-matcher promises.

If the callback has no real `await` after removing matcher-await patterns,
make the callback synchronous.

**GOOD:**

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

When using deep mock helpers from `@reside/common/testing`,
assert method calls through spy handles.

**GOOD:**

```typescript
expect(prisma.permission.findMany.spy()).toHaveBeenCalledTimes(1);
expect(operationService.toApiOperation.spy()).toHaveBeenCalledWith(77);
```

## Assertion Strictness

Avoid brittle full-object equality checks when the object type includes extra generated fields
(for example, Prisma records or generated API payloads).

Prefer property-level assertions for the behavior under test.

**GOOD:**

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
