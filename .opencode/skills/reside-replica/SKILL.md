---
name: reside-replica
description: Use when creating or editing replicas under replicas/*, replica entrypoints, locale files, bootstrap/runtime wiring, package structure, operations, workflow placement, API generation, or e2e layout.
enforcement:
  files:
    - "replicas/*/src/bootstrap/**"
    - "replicas/*/src/replica/**"
    - "replicas/*/src/workflows/**"
    - "replicas/*/src/e2e/**"
    - "replicas/*/src/definitions/**"
    - "replicas/*/src/locale/**"
    - "replicas/*/src/shared/**"
    - "replicas/*/package.json"
    - "replicas/*/tsconfig.json"
---

# ReSide Replica Rules

## Registration and Placement

To add a new replica:

1. Define it in `packages/registry/src/topology.ts`.
2. Add a package in `replicas/<replica-name>/`.
3. Load `reside-changes` for initial `reside.manifest.json` and `CHANGELOG.md` requirements.

When a new replica should start from an existing replica, prefer `bun .opencode/skills/reside-replica/src/scaffold-replica.ts example <new-replica> [russian-title]` instead of manually copying directories, unless another existing replica is a closer domain or architecture match.
The `example` replica is a scaffold source only and must not be registered in topology.
The scaffold script skips dependency directories, generated clients, session state, and old migrations, preserves symlinks, initializes `package.json`, `reside.manifest.json`, and `CHANGELOG.md`, and leaves domain-specific logic for manual edits.

## Tools

- Run replica scaffolding from the repository root with `bun .opencode/skills/reside-replica/src/scaffold-replica.ts <source-replica> <new-replica> [russian-title]`.
- Do not use or add a root package wrapper for this command.

## Replica Package Structure

Each replica package must follow this structure:

- `src/bootstrap/main.ts` is the bootstrap entry point that provisions resources and performs initial setup.
- `src/replica/main.ts` is the runtime entry point that starts both API server and worker logic in one executable.
- `src/workflows/index.ts` is the workflow entry point exported for Temporal bundle at `/app/workflows.js`.
- `src/e2e/main.ts` is the e2e entry point and is mandatory even if no assertions exist yet.
- `src/definitions/` contains shared pure definitions and constants used by workflow-safe code and other modules.
- `src/locale/ru.ts` contains the Russian locale dictionary as `export const ru = { ... }` for all user-facing strings.
- `src/locale/index.ts` reexports locale as `export const strings = ru`.
- `src/replica/business/` contains business logic units grouped by feature.
- `src/replica/services/` contains runtime service implementations grouped by feature.
- `src/replica/services/index.ts` is the mandatory barrel entry for service factories used by `src/replica/main.ts`.
- `src/shared/` is the shared module for bootstrap, replica, and e2e.
- `src/shared/services.ts` is the mandatory service factory used by all entry points.
- `src/database/index.ts` is the database module entry point when the replica has a DB.
- `src/database/_generated/` contains generated Prisma client output and must never be hand-edited.
- `prisma/` contains split Prisma schema files when the replica has a DB.
- `prisma.config.ts` is required when the replica has a DB.
- `package.json` must define `name`, `exports`, and `dependencies` and must not define `version`, `reside`, `main`, or `types`.
- `reside.manifest.json` is required by `reside-changes`.
- `CHANGELOG.md` is required by `reside-changes`.
- `tsconfig.json` extends `../../tsconfig.base.json` and includes `src` and `prisma.config.ts` when present.

Replica package root must not contain extra top-level files or directories outside this contract.

## Import Boundaries

- Top-level directories are `bootstrap`, `replica`, `workflows`, `database`, `e2e`, `definitions`, `locale`, and `shared`.
- Cross-boundary imports must go through the target directory `index.ts`.
- Direct file-to-file imports across top-level directories are forbidden.
- `shared/services.ts` is the central dependency composition point.
- Inside `src/replica/`, feature logic belongs to `src/replica/business/`.
- Do not create additional ad-hoc folders such as `feature`, `reconcile`, or `utils` unless this skill is updated first to explicitly allow them.
- Runtime wiring in `src/replica/main.ts` must import service factories from `src/replica/services/index.ts`, not from individual service files.

## Localization Rules

- All user-facing Russian text must be stored in `src/locale/ru.ts`.
- Runtime code must not contain inline Russian string literals outside `src/locale/*`.
- Use grouped sections in `ru` such as `common`, `bootstrap`, `worker`, `server`, or `operations` to keep strings discoverable.
- Reused texts must be placed in a `common` section.
- Strings with interpolation must be represented as functions.
- All modules should import localized text from `src/locale/index.ts` via `strings.*`.

Example:

```typescript
export const ru = {
  common: {
    hello: (name: string) => `Привет, ${name}`,
  },
};
```

## Runtime Composition Pattern

- Build channels via `createChannels` from topology dependency endpoints.
- Build gRPC clients via `createClient`; do not hardcode transport or client wiring in each module.
- Construct DB and Temporal dependencies in `shared/services.ts` and reuse them across entry points.
- For DB-backed replicas, instantiate Prisma via the generated client from `src/database`.
- Run DB migrations in bootstrap using `runPrismaMigrations`.

## Server Pattern

- Use Connect server composition.
- Start services with `startService`.

## Worker Model and Constraints

- Worker runtime wiring is defined directly in `src/replica/main.ts`.
- Worker entry point may host non-Temporal background logic when needed.
- Keep replicas non-long-running by default.
- Add long-running runtime loops only when they are strictly required by business behavior.

## Temporal Worker Pattern

- Load `reside-workflows` for detailed Temporal rules.
- Use `runTemporalWorker` when Temporal workflows or activities are present.
- Keep workflows and activities in dedicated modules: `src/workflows` and `src/replica/activities`.
- `src/workflows/index.ts` must be the workflow bundle entry point.
- Replica workflow-safe constants and schemas must be imported from `../definitions`.
- Resolve cross-replica operation waits and subscriptions through common operation helpers.

## Bootstrap Pattern

- Use bootstrap helpers from `@reside/common` for standard bootstrap lifecycle.
- Bootstrap is responsible for one-time idempotent initialization and seed data.
- Bootstrap must not duplicate long-running worker or server responsibilities.
- Call `registerReplica` only after all bootstrap resources and setup have completed, including database migrations, common resource definitions, replica-specific resources, permission setup, and `bootstrapService`.
- Registration must be the last bootstrap step so Alpha only advertises replicas whose required resources are already in place.
- All permissions required by `access`, `infra`, and `telegram` replica bootstraps must be created and bound statically in `replicas/access/src/bootstrap/main.ts`, including permissions needed to register reaper handlers.
- Access bootstrap may pre-create placeholder permission rows for permissions owned by `infra` and `telegram` only so those static bindings can be inserted before the owning replica starts.
- `infra` and `telegram` bootstraps must manage the titles and descriptions of their own permission definitions through their normal resource definition flow.
- Access bootstrap must not overwrite metadata for permissions owned by `infra` or `telegram`.

## Operations Contract

- Load `reside-operations` for operation model, callback payload, API subscription, and operation migration rules.

## Subject Identity And Display

- Telegram subject IDs use the format `telegram:{id}`, where `{id}` is the Telegram replica database `User.id`, not a Telegram platform user ID.
- Canonical Telegram subject IDs are not private and must not be wrapped in RHIDs.
- When a field or parameter previously contained an RHID and now contains a canonical subject ID, rename it from `*Rhid` to `*Id`.
- Replicas should pass displayable subject references as isolated subject ID words, for example `Subject: telegram:1` or `Subject: replica:alpha`.
- Telegram-facing display titles are resolved at the Telegram replica output boundary; other replicas should not pre-render subject titles for Telegram messages.

## API and Schema Generation

- Load `reside-api` for protocol changes.
- Protocol changes are made in `packages/api/protocols/*` and then regenerated.
- Generated files under `packages/api/src/_generated` and `src/database/_generated` are outputs, not authoring targets.
- Prisma schema should be split by domain concern into multiple files under `prisma/`.

## Prisma Migration Workflow

- Load `reside-prisma` for Prisma schema, generated client, and migration workflow rules.

## E2E Pattern

- Load `reside-testing` for replica e2e scenario rules.
