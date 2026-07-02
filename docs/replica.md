# Replica Handbook

This document defines the required structure, patterns, and helpers for replicas in ReSide 4.

Changelog and versioning rules are defined in `docs/changes.md`.

## Registration and placement

To add a new replica:

1. Define it in `packages/registry/src/topology.ts`.
2. Add a package in `replicas/<replica-name>/`.
3. Follow `docs/changes.md` for initial `reside.manifest.json` and `CHANGELOG.md` requirements.

When a new replica should start from an existing replica, prefer `bun scripts/scaffold-replica.ts example <new-replica> [russian-title]` instead of manually copying directories, unless another existing replica is a closer domain or architecture match.
The `example` replica is a scaffold source only and must not be registered in topology.
The scaffold script skips dependency directories, generated clients, session state, and old migrations, preserves symlinks, initializes `package.json`, `reside.manifest.json`, and `CHANGELOG.md`, and leaves domain-specific logic for manual edits.

## Replica package structure

Each replica package must follow this structure:

- `src/bootstrap/main.ts` — bootstrap entry point that provisions resources and performs initial setup.
- `src/replica/main.ts` — runtime entry point that starts both API server and worker logic in one executable.
- `src/workflows/index.ts` — workflow entry point exported for Temporal bundle (`/app/workflows.js`).
- `src/e2e/main.ts` — e2e entry point (mandatory even if no assertions yet).
- `src/definitions/` — shared pure definitions/constants used by workflow-safe code and other modules.
- `src/locale/ru.ts` — Russian locale dictionary (`export const ru = { ... }`) for all user-facing strings.
- `src/locale/index.ts` — locale entry point that reexports locale as `export const strings = ru`.
- `src/replica/business/` — business logic units grouped by feature (`{feature}.ts`, `{feature}.test.ts`).
- `src/replica/services/` — runtime service implementations grouped by feature.
- `src/replica/services/index.ts` — mandatory barrel entry for service factories used by `src/replica/main.ts`.
- `src/shared/` — shared module for bootstrap/replica/e2e.
- `src/shared/services.ts` — mandatory service factory used by all entry points.
- `src/database/index.ts` — database module entry point (required if replica has DB).
- `src/database/_generated/` — generated Prisma client output (never hand-edit).
- `prisma/` — split Prisma schema files (required if replica has DB).
- `prisma.config.ts` — Prisma config (required if replica has DB).
- `package.json` — must define `name`, `exports`, `dependencies`; must not define `version`, `reside`, `main`, or `types`.
- `reside.manifest.json` — required by `docs/changes.md`.
- `CHANGELOG.md` — required by `docs/changes.md`.
- `tsconfig.json` — extends `../../tsconfig.base.json`; includes `src` and `prisma.config.ts` when present.

Replica package root must not contain extra top-level files/directories outside this contract.

## Import boundaries

- Top-level directories are: `bootstrap`, `replica`, `workflows`, `database`, `e2e`, `definitions`, `locale`, `shared`.
- Cross-boundary imports must go through the target directory `index.ts`.
- Direct file-to-file imports across top-level directories are forbidden.
- `shared/services.ts` is the central dependency composition point.

Inside `src/replica/`, feature logic belongs to `src/replica/business/`.
Do not create additional ad-hoc folders (for example, `feature`, `reconcile`, `utils`) unless this handbook is updated first to explicitly allow them.
Runtime wiring in `src/replica/main.ts` must import service factories from `src/replica/services/index.ts`, not from individual service files.

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

## Worker model and constraints

- Worker runtime wiring is defined directly in `src/replica/main.ts`.
- Worker entry point may host non-Temporal background logic when needed.
- Keep replicas non-long-running by default; add long-running runtime loops only when they are strictly required by business behavior.

## Temporal worker pattern and helpers

- Use `runTemporalWorker` when Temporal workflows/activities are present.
- Keep workflows and activities in dedicated modules (`src/workflows`, `src/replica/activities`).
- `src/workflows/index.ts` must be the workflow bundle entrypoint.
- Re-export shared workflow helpers (for example `deliverOperationCompletionWorkflow`) only from `src/workflows/index.ts`.
- Workflow modules must import common workflow helpers only from `@reside/common/workflow` (never from `@reside/common`).
- Long-living periodic workflow behavior must be implemented as long-running workflows with `safeSleep` loops, not via Temporal Cron schedules.
- Replica workflow-safe constants/schemas must be imported from `../definitions`.
- Do not use replica-name prefixes for Temporal identifiers (workflow IDs, signals, queries, updates).
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
- `Operation` must include a replica-local `OperationType` enum and a required `type` column.
- Every operation creation site must set `type` to a specific enum value for the producing flow.
- `Operation` may contain fields required by the helper, result references, and named operation identity columns.
- Store identifiers for external operation-related entities, such as deterministic idempotency keys or response context tokens, in dedicated columns instead of `customData`.
- `customData` is reserved for opaque OperationService subscription payloads that must be passed through to completion callbacks, including callback workflow ids embedded in that payload.
- Operation migrations must be deployable on non-empty tables. When adding `Operation.type` or any other required field to an existing table, add it nullable, backfill a deterministic value for all existing rows, and then mark it required; alternatively use a database default when that is the correct long-term model.
- Expose operation subscription API via `createOperationSubscriptionService` when server supports operation callbacks.
- Reaper action payloads must include surrogate identifiers for replica-related resources, such as numeric database ids or sorted binding ids. Do not derive action ids only from stable names like replica names, command names, or resource names, because the same replica name can be recreated with different underlying resources.

## API and schema generation rules

- Protocol changes are made in `packages/api/protocols/*` and then regenerated.
- Generated files under `packages/api/src/_generated` and `src/database/_generated` are outputs, not authoring targets.
- Prisma schema should be split by domain concern into multiple files under `prisma/`.

## Prisma migration workflow

- Interactive development sessions are already launched in the prepared shell with access to the local development PostgreSQL database.
- Do not run `devenv` for migration work unless the task explicitly changes or tests devenv configuration.
- Create migrations with `bun prisma migrate dev`.
- If another migration was already created in the current session, run `bun prisma migrate reset` before creating the next migration.
- Generate migrations with Prisma before editing migration SQL. Manual SQL edits are allowed only for deployability, data backfills, or Prisma limitations, and must be verified with `bun prisma migrate reset --force` followed by `bun prisma migrate dev` against the development PostgreSQL database.
- The development database is used only for generating migrations, so database data is not important.
- Non-interactive engineer tasks must create an isolated temporary development database through the engineer database tool and run Prisma commands with the returned `DATABASE_URL`. Temporary databases are removed after 24 hours; if a resumed session finds the database missing, create a new one and continue.
- The first migration must always be named `init`.
- Every migration after `init` must use a short descriptive name that explains what changed in a few words.

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
