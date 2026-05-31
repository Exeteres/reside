# Prisma Schema Guide and Style

This document captures current Prisma patterns used across ReSide replicas and defines the default style for new schema work.

## Scope

- Applies to all replica schemas under `replicas/*/prisma/*`.
- Applies to Prisma config files (`replicas/*/prisma.config.ts`).
- Applies to migration authoring and naming.

## Current common architecture

- Every DB-backed replica keeps Prisma files in `replicas/<name>/prisma/`.
- `prisma/schema.prisma` is an entry file with `generator` and `datasource` blocks.
- Domain models are split into multiple files (for example: `operation.prisma`, `notification.prisma`, `replica.prisma`).
- Prisma config is centralized through `@reside/common/prisma`.

## File layout rules

- Keep `prisma/schema.prisma` minimal: generators and datasource only.
- Put models/enums in domain-focused files under `prisma/`.
- Group strongly related models in one file when relations are dense.
- Do not place generated artifacts in `prisma/`.
- Generated client output must stay in `src/database/_generated`.

## Prisma config rules

- Use the same config pattern in every replica:

```ts
import { definePrismaConfig } from "@reside/common/prisma";

export default definePrismaConfig();
```

- Do not introduce replica-specific ad-hoc Prisma config unless there is a strong technical reason.

## Modeling conventions

- Use singular PascalCase model names: `Operation`, `Task`, `ReplicaDependencySlot`.
- Use PascalCase enum names and UPPER_SNAKE_CASE enum values.
- Use explicit relation fields with paired foreign keys:
  - key field: `xxxId`
  - relation field: `xxx`
- Always set `onDelete` explicitly in relations (`Cascade`, `SetNull`, `Restrict`) based on lifecycle semantics.
- Add indexes for common lookup paths and relation keys (`@@index`, `@@unique`).
- Prefer explicit composite constraints for business identity (for example `@@unique([replicaId, name])`).

## Field style guide

- Use 2 spaces for indentation in Prisma schema files.
- Primary key defaults:
  - use `Int @id @default(autoincrement())` by default
  - use `BigInt` only where high cardinality is expected or already established in that area
- Timestamps:
  - `createdAt DateTime @default(now())`
  - `updatedAt DateTime @updatedAt` for mutable entities
  - optional terminal timestamps like `resolvedAt DateTime?` for stateful flows
- Keep nullable columns explicit with `?`.
- Keep machine fields and user-facing fields separate:
  - machine: `failureReason`, `status`, ids, scopes
  - user-facing: `title`, `description`, `failureMessage`

## Documentation style in schema files

- Prefer `///` doc comments for models and non-obvious fields.
- Write comments in English.
- Document domain meaning, not syntax-level obvious facts.
- For JSON columns with known shape, document expected type near the field.

## JSON field rules

- Use `Json` only when structure is truly dynamic or externally defined payload is stored.
- For typed JSON usage, use `prisma-json-types-generator` and annotate each typed JSON field with Prisma doc comments.
- Prefer normalized relational models over JSON when queryability and constraints are important.

### Typed JSON generator

- Keep this generator in `prisma/schema.prisma` for replicas that rely on typed JSON:

```prisma
generator json {
  provider = "prisma-json-types-generator"
}
```

- If a replica has `Json` fields with documented app-level types, the `json` generator must be enabled.

### Typed JSON comment format

- Use Prisma doc comments immediately above the `Json` field.
- Use square brackets to reference the generated type name: `/// [TypeName]`.
- Keep one type reference per `Json` field and keep the type name stable and explicit.
- Example:

```prisma
/// The raw Telegram payload for the chat.
///
/// [ChatData]
data Json
```

- Array/object shape notation in comments must also use square brackets through a named type (for example `NotificationActionRowsData`) instead of inline anonymous JSON shape descriptions.

## Operation model pattern

Many replicas use a workflow/operation pattern.

- Keep one `Operation` model per replica.
- Keep generic operation fields compatible with common helpers.
- Attach feature-specific entities via optional foreign keys and explicit relations.
- Index operation lifecycle queries (`@@index([createdAt])`, status-specific indexes where needed).

## Migration workflow and naming

- Start dev DB before migration creation:
  - `devenv up -d`
- If another migration was created in the same session, reset first:
  - `bun prisma migrate reset --force`
- Create migration:
  - `bun prisma migrate dev --name <name>`
- Migration naming:
  - first migration must be `init`
  - later migrations must be short descriptive names of what changed
- The dev database is used for migration generation only; data persistence is not important.

## Change checklist

- Schema split remains domain-based under `prisma/`.
- New/changed relations include explicit `onDelete` behavior.
- Required indexes/uniques were added for new lookup paths.
- `createdAt`/`updatedAt` conventions are preserved.
- JSON fields are justified and documented.
- Migration name follows the naming policy.
