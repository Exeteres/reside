# Temporal Workflow and Activity Style

This document defines the required style for Temporal workflows and activities in ReSide replicas.

## Naming

- Activity and workflow function names must be camelCase.
- Workflow function names must end with `Workflow`.
- Input model names must end with `Input`.
- Output model names must end with `Output`.
- Model names are derived from function names: `{X}Input`, `{X}Output` for function `X`.
- If an input or output object would be empty, omit that model entirely.
- Do not use replica-name prefixes for Temporal identifiers (workflow IDs, signal names, query names, update names).

## Definitions placement

- Activities, activity inputs, and activity outputs are declared in `src/definitions/activities.ts`.
- Workflows, workflow inputs, workflow outputs, and signal declarations are declared in `src/definitions/workflows.ts`.
- Export these definitions from `src/definitions/index.ts`.
- In `definitions/activities.ts`, place models (`*Input`, `*Output`, helper aliases) first and activity object types last.

## Activity file structure

- Place activity implementations in feature files under `src/replica/activities/{feature}.ts`.
- `src/replica/activities/index.ts` must only re-export feature modules and must not contain activity implementations.
- Use `create{Feature}Activities` for feature factory names.
- Use `{Feature}ActivityServices` for extracted factory service type names.
- If activity logic belongs to the whole replica (not a narrower domain), use the replica name as the feature name.

## Workflow file structure

- Place workflow implementations in feature files under `src/workflows/{feature}.ts`.
- `src/workflows/index.ts` must only re-export workflow feature modules and must not contain workflow implementations.
- Re-exports of common workflow helpers (for example `deliverOperationCompletionWorkflow`) must be declared in `src/workflows/index.ts`, not in feature workflow files.
- Group workflows by feature, using the same grouping principle as activities.
- Workflow file layout does not need to mirror activity file layout exactly.
- Choose workflow and activity grouping independently per replica when that better matches the domain.

## Activity contract rules

- Every activity must accept exactly one argument object.
- If activity input is empty, omit activity args and use a zero-argument function signature.
- If an activity returns any data, the return type must be an object (`XOutput`), never a primitive/array/union directly.
- Activity implementations must be exported as factory functions.
- Activity factory arguments must always be deconstructed in the function signature.
- Extract factory service argument type into a separate `type <X>ActivityServices = ...` alias.
- Factory argument shape should be a superset of replica services so callers can pass `services` directly.
- Extend `CommonServices<...>` when those groups are actually present in the replica service object.
- Factory functions must return an object compatible with the activity type from `definitions/activities.ts`.
- Methods inside the returned activities object must not explicitly annotate argument/return types.

## Activity definitions documentation

- All activity function declarations in `definitions/activities.ts` must have full multi-line JSDoc.
- Do not use `@param` and `@returns` tags in these definition docs.
- Every field in `*Input` and `*Output` models must have full multi-line JSDoc.
- Keep spacing clear between documented fields (avoid tightly packed field blocks).

## Workflow contract rules

- Workflow functions must destructure input arguments in the function signature.
- Activities in workflows must be obtained via destructuring from `proxyActivities`.
- Workflow code must call activities with a single args object.

## Temporal error handling

- Configure non-retryable activity failures via `retry.nonRetryableErrorTypes`.
- Always reference custom error classes by name: `nonRetryableErrorTypes: [MyError.name]`.
- Keep retry type names in sync with classes from `src/definitions/errors.ts`.
- Use `isResideError(error, MyError.name)` from `@reside/common/definitions` for workflow error branching.
- Do not rely on prefix-based error message parsing as workflow control flow.
- Do not throw `ApplicationFailure` manually for expected domain errors in activities.
- Throw domain-specific `ResideError` subclasses from activities and let Temporal propagate their type.

## Signal rules

- Signal payload models must be declared in `definitions/workflows.ts`.
- Signals must be declared in `definitions/workflows.ts` as exported `defineSignal(...)` values.
- Do not decompose signals into separate name/args helper functions.
- Workflow and runtime code must reuse exported signal definitions directly (for `setHandler` and `workflowHandle.signal`).

## Example: Alpha activity factory

```ts
type RegistrationActivityServices = {
  prisma: PrismaClient;
  operationService: GenericOperationService<Operation>;
};

export function createRegistrationActivities({
  prisma,
  operationService,
}: RegistrationActivityServices): RegistrationActivities {
  return {
    async reconcileRegistrationOperation({ operationId }) {
      // ...
      return "completed";
    },
  };
}
```

## Example: Workflow with destructured proxy activities

```ts
const { reconcileRegistrationOperation } =
  proxyActivities<RegistrationActivities>({
    startToCloseTimeout: "1 minute",
    scheduleToCloseTimeout: "10 minutes",
  });

export async function waitForReplicaRegistrationWorkflow({
  operationId,
}: WaitForReplicaRegistrationWorkflowArgs): Promise<void> {
  while (true) {
    const status = await reconcileRegistrationOperation({ operationId });
    if (status === "completed") {
      return;
    }

    await sleepSafely(5_000);
  }
}
```

## Example: Activity with empty args object

```ts
export type FetchKeyRateOutput = {
  rate: number;
};

export type RateActivities = {
  fetchKeyRate: () => Promise<FetchKeyRateOutput>;
};

export function createRateActivities(): RateActivities {
  return {
    async fetchKeyRate() {
      return {
        rate: 0,
      };
    },
  };
}
```
