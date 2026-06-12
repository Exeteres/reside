# NLS Subsystem Style Guide

This document defines required rules for connecting `setupLanguageSubsystem` and implementing replica-specific NLS tools.

## Mandatory replica integration

- Every replica must call `setupLanguageSubsystem` in `src/replica/main.ts` as part of runtime wiring.
- Keep the call close to server route setup so NLS connectivity is explicit in composition.
- Pass localized `title` and `description` from replica locale.
- Provide replica-specific `instructions` that describe how the replica should behave with users.

## Custom tool layout

- If a replica adds custom NLS tools, place them in `src/replica/nls/`.
- Group tools by feature in `src/replica/nls/{feature}.ts`.
- `src/replica/nls/index.ts` must only re-export feature modules.
- Do not place tool implementations directly in `src/replica/main.ts`.

## Tool definition rules

- Define tools with `defineTool` (or `defineTools` when available in the used SDK API).
- Tools without external dependencies must be exported as constants.
- Tools with external dependencies must be exported as factories.

## Tool factory rules

- Apply the same factory rules as activity factories.
- Use explicit dependency injection from runtime composition.
- Prefer a single object argument deconstructed in function signature.
- Extract factory dependency argument type into a named alias.
- Keep dependency shapes compatible with passing replica `services` directly when practical.

## Memory integration

- `services.prisma` is required for NLS engine setup.
- Keep memory schema in replica Prisma via a relative symlink to `packages/common/prisma/memory.prisma`.
- Ensure replica services expose Prisma client as `services.prisma` (same object passed to `setupLanguageSubsystem`).
- Run Prisma migration in replica bootstrap before starting runtime.
- Do not register memory tools manually: they are attached by `createLanguageEngine` automatically.

Practical integration flow:

- 1. Add `prisma/memory.prisma` symlink to shared memory schema.
- 2. Ensure `prisma/schema.prisma` contains generator/datasource and client output to `src/database/_generated`.
- 3. Add `prisma.config.ts` with `definePrismaConfig()`.
- 4. In `src/shared/services.ts`, create Prisma client and return it as `prisma` in `services`.
- 5. In bootstrap, call `runPrismaMigrations(services.pool)` before resource definitions.
- 6. Call `setupLanguageSubsystem({ services, ... })` without extra memory-tool wiring.
