---
name: reside-typescript
description: Use when editing TypeScript code, imports, JSDoc, async control flow, comments, type aliases, unions, generics, errors, logging, or general implementation style in ReSide.
skill_enforcement:
  patterns:
    - "apps/**/*.ts"
    - "packages/**/*.ts"
    - "replicas/**/*.ts"
    - ".opencode/skills/*/src/**/*.ts"
    - ".opencode/plugins/*/src/**/*.ts"
---

# ReSide TypeScript Rules

## Constructor Parameter Injection

Inject dependencies through the constructor and mark them `private readonly`.

Good:

```typescript
class ArtifactService {
  constructor(
    private readonly stateManager: StateManager,
    private readonly artifactBackend: ArtifactBackend,
    private readonly lockManager: LockManager,
    private readonly logger: Logger,
  ) {}
}
```

## Null Coalescing and Default Values

Prefer modern operators like `??` and optional chaining for defaults.

Good:

```typescript
const value = input ?? defaultValue;
const config = options?.config ?? {};
```

Bad:

```typescript
const value = input || defaultValue;
const config = (options && options.config) || {};
```

## Async and Await

Favor `async` and `await` over promise chains for readability.
Always await promises even when returning, do not passthrough unawaited promises.

Good:

```typescript
async function processData(): Promise<Result> {
  const data = await fetchData();
  const transformed = await transformData(data);

  return await saveData(transformed);
}
```

Bad:

```typescript
function processData(): Promise<Result> {
  return fetchData()
    .then((data) => transformData(data))
    .then((transformed) => saveData(transformed));
}

function processData(): Promise<Result> {
  return someAsyncOperation();
}
```

## Early Returns

Use early exits to reduce nesting and clarify control flow.
The main logic should be at the base indentation level, while guards and error checks should have their own blocks above.

Good:

```typescript
async function updateUsage(
  projectId: string,
  usage: ArtifactUsage,
): Promise<void> {
  if (artifactIds.length === 0 || usages.length === 0) {
    return;
  }

  const artifact = artifacts[artifactId];
  if (!artifact) {
    this.logger.warn({ projectId }, `artifact "%s" not found`, artifactId);
    return;
  }

  await this.doWork(projectId, artifact, usage);
}
```

## Function Documentation

- Document public methods with full JSDoc sentences and parameter descriptions.
- Place each sentence on its own line.
- Split the description to multiple paragraphs if needed via blank lines.
- Params must be documented with `@param` tags without `-` and should also be complete sentences.
- Do not use `@returns` for `void` functions or `Promise<void>` functions.
- Private methods must not define JSDoc.
- If a method has `export` but is not exported from the package, it is still considered private and should not have JSDoc.

Good:

```typescript
/**
 * Updates the worker registrations for the given project and instance.
 *
 * It creates new registrations for each unit worker, updates existing ones,
 * and deletes registrations that are no longer present.
 *
 * @param projectId The ID of the project.
 * @param instanceId The ID of the instance.
 * @param unitWorkers The list of unit workers to register.
 * @returns A new mapping of unit worker names to their registration IDs.
 */
async updateUnitRegistrations(
  projectId: string,
  instanceId: string,
  unitWorkers: UnitWorker[],
): Promise<Record<string, string>> {
  // implementation
}
```

## Method Chaining and Fluent APIs

Format fluent chains for clarity and force splits with `//` when needed.
Biome and Prettier try to keep lines under 100 characters, but not consistently enough.
When a line exceeds 100 characters, break after each call in the chain.

Good:

```typescript
const filtered = items
  .filter((item) => item.isValid)
  .map((item) => this.transform(item))
  .sort((a, b) => a.name.localeCompare(b.name));

this.stateUnlockService.registerUnlockTask(
  //
  "process-lost-operations",
  (projectId) => this.processLostOperations(projectId),
);
```

## Inline Comments

- Use inline comments only to explain non-obvious code.
- Avoid comments that state the obvious or repeat what the code does.
- Inline comments should be fragments written in lowercase without punctuation.
- Inline comments may start with numbering to help break down complex logic.
- Inline comments may also be blocks of full sentences if they explain a complex algorithm or reasoning.
- All comments must be written in English.

Good:

```typescript
// calculate affected instances in multiple phases
// 1. extend requested ids with dependencies
for (const instanceId of this.operation.requestedInstanceIds) {
  if (this.operation.type === "update") {
    await traverse(instanceId);
  }

  this.instanceIdsToUpdate.add(instanceId);
}
```

## Line Breaks and Visual Spacing

- Group related operations and add breathing room between distinct blocks.
- Leave blank lines after guard clauses, between loops, and around multiline calls.
- Do not clump statements together or over-space compact structures.

## Type Definitions

Use `type` for data structures and `interface` for behavioral contracts.

Good:

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

## Type References

Prefer explicit domain types over utility-composed type expressions for declarations.

- Do not use composed utility expressions like `Awaited<ReturnType<typeof fn>>["field"]` for local variables, parameters, or return types when a direct type can be imported or declared.
- Prefer explicit imports or a named exported local alias from the source module.
- Do not add pass-through aliases that only rename an existing type.

Good:

```typescript
import type { TracerProvider } from "@opentelemetry/api";

let tracerProvider: TracerProvider | undefined;
```

Bad:

```typescript
let tracerProvider: Awaited<
  ReturnType<typeof setupTelemetry>
>["tracerProvider"];

type Services = Awaited<ReturnType<typeof createServices>>;
let prisma: Services["prisma"];
type EngineerPrismaClient = PrismaClient;
```

## Type Safety and Generics

Lean on TypeScript's type system and constrain generics.
Do not use `any`.

`any` is allowed only for complex cases with explicit `/** biome-ignore-all lint/suspicious/noExplicitAny: explanation */` or `// biome-ignore lint/suspicious/noExplicitAny: explanation` comments.

Good:

```typescript
function getOrCreate<T>(
  cache: Map<string, T>,
  key: string,
  factory: (key: string) => T,
): T {
  return cache.get(key) ?? cache.set(key, factory(key)).get(key)!;
}
```

## String Unions

- Do not use inline string unions in object fields.
- Extract string unions into named type aliases.
- Prefer descriptive names based on domain meaning.
- Reuse extracted aliases across related models instead of duplicating unions.

## Array Types

- Do not use `Array<T>` syntax.
- Use `T[]` syntax for all array types.
- For arrays of objects, extract the item object type into a named alias and reference it as `ItemType[]`.

Good:

```typescript
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

## Error Handling

- Catch and rethrow with context while preserving the original cause.
- Use `cause` to wrap errors instead of embedding messages.
- Keep errors capitalized without punctuation and surround identifiers with double quotes.

Good:

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

Bad:

```typescript
try {
  await operation();
} catch (error) {
  throw new Error(`Failed to update instance ${instanceId}: ${error.message}.`);
}
```

## Custom Error Definitions

- Place replica-defined custom errors in `src/definitions/errors.ts`.
- Export them from `src/definitions/index.ts`.
- Import custom errors from `../definitions` or `../../definitions` instead of deep file paths.
- Extend `ResideError` from `@reside/common/definitions` for all domain-level custom errors.
- Do not manually assign `this.name`.
- Accept error-specific fields through constructor arguments and mark these fields `readonly`.
- Build the final message in the error class constructor whenever possible.
- Keep message formatting deterministic and human-readable.

## Custom Error Usage

- Throw custom error classes for expected domain failures.
- Avoid prefix-based message parsing for domain control flow.
- Keep unknown or unexpected failures as generic errors and handle them separately.
- Load `reside-workflows` for Temporal-specific error propagation and retry rules.

## Logging

- Use `pino` for structured logging.
- Log messages must be lowercase without punctuation.
- Use printf-style messages with explicit key-value placeholders: `key="%s"`.
- Always pass dynamic values as logger arguments, never via string interpolation.
- Do not pass context objects for regular logs.
- Keep keys snake_case in log messages.
- Use `createProjectLogger` instead of passing `projectId` manually.
- For any error or warn log that includes an error, always pass a context object with `error` key: `logger.error({ error }, ...)`.
- The `error` value must be an `Error` instance. Do not stringify errors in logs.

Good:

```typescript
const logger = createProjectLogger(this.logger, projectId);

logger.info(
  'updating worker registration registration_id="%s" unit_worker_name="%s" params_changed="%s"',
  registration.id,
  unitWorker.name,
  "true",
);

logger.error(
  { error },
  'failed to process operation operation_id="%s"',
  operationId,
);
```

Bad:

```typescript
this.logger.error(
  { err, projectId },
  `Failed to process operation for project ${projectId}.`,
);

logger.info(`updating worker registration ${registration.id}`);

logger.error(
  'failed to process operation operation_id="%s" error="%s"',
  operationId,
  error.message,
);
```
