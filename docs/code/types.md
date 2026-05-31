# Type Definitions Rules

This document defines general requirements for TypeScript type definitions in ReSide.

## Type definitions

Use `type` for data structures and `interface` for behavioral contracts.

**GOOD:**

```typescript
export type NamespaceArgs = {
  cluster: Input<k8s.Cluster>;
  privileged?: boolean;
};

interface ArtifactBackend {
  store(projectId: string, hash: string): Promise<void>;
  exists(projectId: string, hash: string): Promise<boolean>;
}
```

## Type references

Prefer explicit domain types over utility-composed type expressions for declarations.

- Do not use composed utility expressions like `Awaited<ReturnType<typeof fn>>["field"]` for local variables, parameters, or return types when a direct type can be imported or declared.
- Prefer explicit imports (for example `TracerProvider`) or a named exported local alias from the source module.
- Do not add pass-through aliases that only rename an existing type (for example `type LocalPrisma = PrismaClient`). Use the original type directly.

**GOOD:**

```typescript
import type { TracerProvider } from "@opentelemetry/api";

let tracerProvider: TracerProvider | undefined;
```

**BAD:**

```typescript
let tracerProvider: Awaited<
  ReturnType<typeof setupTelemetry>
>["tracerProvider"];

type Services = Awaited<ReturnType<typeof createServices>>;
let prisma: Services["prisma"];

type EngineerPrismaClient = PrismaClient;
```

## Type safety and generics

Lean on TypeScript's type system and constrain generics.
Do not even think about using `any`.

Note: `any` is allowed for complex cases with exclicit `/** biome-ignore-all lint/suspicious/noExplicitAny: explanation */` or `// biome-ignore lint/suspicious/noExplicitAny: explanation` comments.

**GOOD:**

```typescript
function getOrCreate<T>(
  cache: Map<string, T>,
  key: string,
  factory: (key: string) => T,
): T {
  return cache.get(key) ?? cache.set(key, factory(key)).get(key)!;
}
```

**BAD:**

```typescript
function getOrCreate(cache: any, key: string, factory: Function): any {
  return cache.get(key) || cache.set(key, factory(key)).get(key);
}
```

## String unions

- Do not use inline string unions in object fields.
- Extract string unions into named type aliases.
- Prefer descriptive names based on domain meaning (for example: `TaskStatus`, `Phase`, `OperationState`).
- Reuse extracted aliases across related models instead of duplicating unions.

## Array types

- Do not use `Array<T>` syntax.
- Use `T[]` syntax for all array types.
- For arrays of objects, extract the item object type into a named alias and reference it as `ItemType[]`.

## Example

```ts
export type TaskStatus = "PLANNING" | "IN_PROGRESS" | "COMPLETED";

export type TaskApprover = {
  id: number;
  name: string;
};

export type TaskOutput = {
  status: TaskStatus;
  approvers: TaskApprover[];
};
```
