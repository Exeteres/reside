---
name: reside-prisma
description: Use when editing Prisma schema files, prisma.config.ts, migrations, database models, relations, indexes, JSON fields, Operation models, generated Prisma clients, or Prisma migration workflows.
enforcement:
  files:
    - "replicas/*/prisma/**"
    - "replicas/*/prisma.config.ts"
    - "replicas/*/src/database/_generated/**"
---

# ReSide Prisma Rules

## Scope

- Applies to all replica schemas under `replicas/*/prisma/*`.
- Applies to Prisma config files at `replicas/*/prisma.config.ts`.
- Applies to migration authoring and naming.

## Common Architecture

- Every DB-backed replica keeps Prisma files in `replicas/<name>/prisma/`.
- `prisma/schema.prisma` is an entry file with `generator` and `datasource` blocks.
- Domain models are split into multiple files such as `operation.prisma`, `notification.prisma`, and `replica.prisma`.
- Prisma config is centralized through `@reside/common/prisma`.

## File Layout Rules

- Keep `prisma/schema.prisma` minimal: generators and datasource only.
- Put models and enums in domain-focused files under `prisma/`.
- Group strongly related models in one file when relations are dense.
- Do not place generated artifacts in `prisma/`.
- Generated client output must stay in `src/database/_generated`.

## Prisma Config Rules

Use the same config pattern in every replica:

```typescript
import { definePrismaConfig } from "@reside/common/prisma";

export default definePrismaConfig();
```

Do not introduce replica-specific ad-hoc Prisma config unless there is a strong technical reason.

## Modeling Conventions

- Use singular PascalCase model names such as `Operation`, `Task`, or `ReplicaDependencySlot`.
- Use PascalCase enum names and UPPER_SNAKE_CASE enum values.
- Use explicit relation fields with paired foreign keys.
- Key fields are named `xxxId`.
- Relation fields are named `xxx`.
- Always set `onDelete` explicitly in relations based on lifecycle semantics: `Cascade`, `SetNull`, or `Restrict`.
- Add indexes for common lookup paths and relation keys with `@@index` and `@@unique`.
- Prefer explicit composite constraints for business identity, for example `@@unique([replicaId, name])`.

## Field Style

- Use 2 spaces for indentation in Prisma schema files.
- Use `Int @id @default(autoincrement())` primary keys by default.
- Use `BigInt` only where high cardinality is expected or already established in that area.
- Use `createdAt DateTime @default(now())` for creation timestamps.
- Use `updatedAt DateTime @updatedAt` for mutable entities.
- Use optional terminal timestamps such as `resolvedAt DateTime?` for stateful flows.
- Keep nullable columns explicit with `?`.
- Keep machine fields and user-facing fields separate.
- Machine fields include `failureReason`, `status`, IDs, and scopes.
- User-facing fields include `title`, `description`, and `failureMessage`.

## Documentation Style in Schema Files

- Prefer `///` doc comments for models and non-obvious fields.
- Write comments in English.
- Document domain meaning, not syntax-level obvious facts.
- For JSON columns with known shape, document expected type near the field.

## JSON Field Rules

- Use `Json` only when structure is truly dynamic or externally defined payload is stored.
- For typed JSON usage, use `prisma-json-types-generator` and annotate each typed JSON field with Prisma doc comments.
- Prefer normalized relational models over JSON when queryability and constraints are important.

## Typed JSON Generator

Keep this generator in `prisma/schema.prisma` for replicas that rely on typed JSON:

```prisma
generator json {
  provider = "prisma-json-types-generator"
}
```

If a replica has `Json` fields with documented app-level types, the `json` generator must be enabled.

## Typed JSON Comment Format

- Use Prisma doc comments immediately above the `Json` field.
- Use square brackets to reference the generated type name: `/// [TypeName]`.
- Keep one type reference per `Json` field and keep the type name stable and explicit.
- Array/object shape notation in comments must also use square brackets through a named type instead of inline anonymous JSON shape descriptions.

Example:

```prisma
/// The raw Telegram payload for the chat.
///
/// [ChatData]
data Json
```

## Operation Model Pattern

- Load `reside-operations` for operation model, callback payload, API subscription, and operation migration rules.

## Migration Workflow and Naming

- Interactive development sessions are already launched in the prepared shell with access to the local development PostgreSQL database.
- Do not run `devenv` for migration work unless the task explicitly changes or tests devenv configuration.
- If another migration was created in the same session, reset first with `bun prisma migrate reset --force`.
- Create migrations with `bun prisma migrate dev --name <name>`.
- Do not author migrations from scratch by hand.
- Generate the migration with Prisma first.
- Manual SQL edits are allowed only when Prisma's generated SQL is not deployable or cannot express the required migration safely, for example nullable-add/backfill/set-not-null sequences, data backfills, or provider-specific DDL.
- When Prisma diff shows schema drift beyond the immediate error, do not create a partial migration silently.
  Either cover the full drift in the migration or ask the user before intentionally splitting it.
- New migrations must be safe to apply to non-empty tables.
- Do not add a required column without either a database default or an explicit backfill step that adds it nullable, fills all existing rows, and only then marks it `NOT NULL`.
- Warnings for unique indexes on nullable columns created in the same migration are acceptable when existing rows cannot contain duplicates for that new column.
- After any manual migration SQL edit, verify it against the development PostgreSQL database before submitting.
- Run `bun prisma migrate reset --force`.
- Run `bun prisma migrate dev`.
- The final `migrate dev` must report the schema is already in sync.
- The first migration must be named `init`.
- Later migrations must use short descriptive names of what changed.
- The dev database is used for migration generation only; data persistence is not important.
- Non-interactive engineer tasks must create isolated temporary development databases through the engineer database tool.
- For `prisma migrate dev`, create two databases: use the first URL as `DATABASE_URL` and the second URL as `SHADOW_DATABASE_URL` so Prisma does not need permission to create its own shadow database.
- For Prisma checks or database-backed tests that do not run `migrate dev`, one temporary `DATABASE_URL` is enough.
- Temporary databases are removed after 24 hours; if a resumed session finds a database missing, create a replacement for each missing URL and continue.

## Encryption Cross-Check

- Load `reside-encryption` before adding or changing fields, JSON columns, logs, persistence paths, or migrations that may involve personal information.
- Personal information in database models must be encrypted or hashed, never stored as plaintext.

## Change Checklist

- Schema split remains domain-based under `prisma/`.
- New or changed relations include explicit `onDelete` behavior.
- Required indexes and uniques were added for new lookup paths.
- `createdAt` and `updatedAt` conventions are preserved.
- JSON fields are justified and documented.
- Migration name follows the naming policy.
