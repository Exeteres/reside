# Replica Handbook

This document defines the required structure, patterns, and helpers for replicas in ReSide 4.

## Registration and placement

To add a new replica:

1. Define it in `packages/registry/src/topology.ts`.
2. Add a package in `replicas/<replica-name>/`.

## Replica package structure

Each replica package must follow this structure:

- `src/bootstrap/main.ts` — bootstrap entry point that provisions resources and performs initial setup.
- `src/replica/main.ts` — runtime entry point that starts both API server and worker logic in one executable.
- `src/workflows/main.ts` — workflow entry point exported for Temporal bundle (`/app/workflows.js`).
- `src/e2e/main.ts` — e2e entry point (mandatory even if no assertions yet).
- `src/definitions/` — shared pure definitions/constants used by workflow-safe code and other modules.
- `src/locale/ru.ts` — Russian locale dictionary (`export const ru = { ... }`) for all user-facing strings.
- `src/locale/index.ts` — locale entry point that reexports locale as `export const strings = ru`.
- `src/shared/` — shared module for bootstrap/replica/e2e.
- `src/shared/services.ts` — mandatory service factory used by all entry points.
- `src/database/index.ts` — database module entry point (required if replica has DB).
- `src/database/_generated/` — generated Prisma client output (never hand-edit).
- `prisma/` — split Prisma schema files (required if replica has DB).
- `prisma.config.ts` — Prisma config (required if replica has DB).
- `package.json` — must define `name`, `version`, `reside`, `exports`, `dependencies`; must not define `main` or `types`.
- `tsconfig.json` — extends `../../tsconfig.base.json`; includes `src` and `prisma.config.ts` when present.

Replica package root must not contain extra top-level files/directories outside this contract.

## Import boundaries

- Top-level directories are: `bootstrap`, `replica`, `workflows`, `database`, `e2e`, `definitions`, `locale`, `shared`.
- Cross-boundary imports must go through the target directory `index.ts`.
- Direct file-to-file imports across top-level directories are forbidden.
- `shared/services.ts` is the central dependency composition point.

## Localization rules

- All user-facing Russian text must be stored in `src/locale/ru.ts`.
- Runtime code must not contain inline Russian string literals outside `src/locale/*`.
- Use grouped sections in `ru` (for example: `common`, `bootstrap`, `worker`, `server`, `operations`) to keep strings discoverable.
- Reused texts must be placed in a `common` section.
- Strings with interpolation must be represented as functions (for example: `hello: (name: string) => \`Привет, ${name}\``).
- All modules should import localized text from `src/locale/index.ts` via `strings.*`.

## Required runtime composition pattern

- Build channels via `createChannels` from topology dependency endpoints.
- Build gRPC clients via `createClient`; do not hardcode transport/client wiring in each module.
- Construct DB/Temporal dependencies in `shared/services.ts` and reuse them across entry points.
- For DB-backed replicas, instantiate Prisma via generated client from `src/database`.
- Run DB migrations in bootstrap using `runPrismaMigrations`.

## Server pattern and helpers

- Use Connect server composition and start with `startService`.
- Register service implementations directly in `src/replica/main.ts`.
- Use authentication helpers from `@reside/common` (`authenticate`, `authenticateReplica`) in service handlers.
- Keep business logic in `src/replica/services/*`, while `main.ts` should contain only runtime wiring.

## Service dependency conventions

- Entry points must keep the full `services` object (`const services = await createServices()`) and should not destructure it in `src/replica/main.ts` and `src/bootstrap/main.ts`.
- `create*Service` factories must accept a single object argument and must destructure it in the function signature using expandable full form, even when there is only one dependency.
- Example required signature style:

```typescript
export function createBindingService({
  prisma,
}: {
  prisma: PrismaClient;
}): BindingServiceImplementation {
  // ...
}
```

- If a dependency exists in some `CommonServices<...>` API group, factory typing must include and use that `CommonServices` field instead of introducing parallel ad-hoc dependency providers.
- Shared business functions used mostly by business services (non-`@reside/common` helpers) must accept explicit service/dependency arguments (for example `prisma`) to keep them easy to test in isolation.

## Worker model and constraints

- Worker runtime wiring is defined directly in `src/replica/main.ts`.
- Worker entry point may host non-Temporal background logic when needed.

## Temporal worker pattern and helpers

- Use `runTemporalWorker` when Temporal workflows/activities are present.
- Keep workflows and activities in dedicated modules (`src/workflows`, `src/replica/activities`).
- `src/workflows/main.ts` must be the workflow bundle entrypoint.
- Workflow modules must import common workflow helpers only from `@reside/common/workflow` (never from `@reside/common`).
- Replica workflow-safe constants/schemas must be imported from `../definitions`.
- Keep workflow code deterministic and pure: no direct network/database/filesystem/time/random side effects.
- Put workflow-safe constants, schemas, and reusable pure helpers in `src/definitions/*`.
- Place non-deterministic logic (I/O, API calls, DB, wall-clock timers, random generation) in activities or non-workflow runtime layers.
- Use workflow helpers from `@reside/common/workflow` where applicable.
- Don't import `@reside/common` in workflow code, it will not compile.
- Resolve cross-replica operation waits/subscriptions through common operation helpers.

## Bootstrap pattern and helpers

- Use bootstrap helpers from `@reside/common` for standard bootstrap lifecycle.
- Bootstrap is responsible for one-time idempotent initialization and seed data.
- Bootstrap must not duplicate long-running worker/server responsibilities.

## Operations contract (mandatory)

- Replica operations must use `createGenericOperationService` from `@reside/common`.
- Replica DB must contain exactly one `Operation` entity compatible with the generic helper.
- `Operation` may contain only fields required by the helper and result references.
- Additional business fields on `Operation` are not allowed.
- Expose operation subscription API via `createOperationSubscriptionService` when server supports operation callbacks.

## API and schema generation rules

- Protocol changes are made in `packages/api/protocols/*` and then regenerated.
- Generated files under `packages/api/src/_generated` and `src/database/_generated` are outputs, not authoring targets.
- Prisma schema should be split by domain concern into multiple files under `prisma/`.

## E2E pattern

- Keep replica e2e scenarios in `src/e2e/*` and orchestrate from `src/e2e/main.ts`.
- E2E entry must set up required fixtures, run checks, and always clean up in `finally`.
- Every database entity created by e2e (directly or indirectly) must be deleted during cleanup in the same run.
- Cleanup must be deterministic and idempotent, and must not leave residual records after successful or failed test execution.
- E2E must not mutate pre-existing non-e2e data.
- E2E fixtures must use per-run unique identifiers/names to avoid collisions with real records.
- If an API check must touch a singleton/shared entity, e2e must snapshot its original state and restore it fully in cleanup.
- Exception: long-lived e2e permission grants may be kept intentionally (without cleanup) to avoid interactive approval prompts in repeated e2e runs, but this exception applies only to permission grants used by e2e and must be documented in the corresponding e2e module.
- E2E should exercise public API/contracts rather than internal implementation details.
