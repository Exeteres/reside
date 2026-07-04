---
name: reside-nls
description: Use when editing setupLanguageSubsystem, src/replica/nls tools, NLS memory, LLM tool definitions, language engine integration, replica assistant instructions, or NLS-facing data boundaries.
skill_enforcement:
  patterns:
    - "replicas/*/src/replica/nls/**"
    - "replicas/*/src/replica/setupLanguageSubsystem.ts"
    - "replicas/*/src/replica/assistant/**"
---

# ReSide NLS Rules

## Mandatory Replica Integration

- Every replica must call `setupLanguageSubsystem` in `src/replica/main.ts` as part of runtime wiring.
- Keep the call close to server route setup so NLS connectivity is explicit in composition.
- Pass localized `title` and `description` from replica locale.
- Provide replica-specific `instructions` that describe how the replica should behave with users.

## Custom Tool Layout

- If a replica adds custom NLS tools, place them in `src/replica/nls/`.
- Group tools by feature in `src/replica/nls/{feature}.ts`.
- `src/replica/nls/index.ts` must only re-export feature modules.
- Do not place tool implementations directly in `src/replica/main.ts`.

## Tool Definition Rules

- Define tools with `defineTool` or `defineTools` when available in the used SDK API.
- Tools without external dependencies must be exported as constants.
- Tools with external dependencies must be exported as factories.

## Tool Factory Rules

- Apply the same factory rules as activity factories.
- Use explicit dependency injection from runtime composition.
- Prefer a single object argument destructured in the function signature.
- Extract factory dependency argument type into a named alias.
- Keep dependency shapes compatible with passing replica `services` directly when practical.

## Memory Integration

- `services.prisma` is required for NLS engine setup.
- Keep memory schema in replica Prisma via a relative symlink to `packages/common/prisma/memory.prisma`.
- Ensure replica services expose Prisma client as `services.prisma` using the same object passed to `setupLanguageSubsystem`.
- Run Prisma migration in replica bootstrap before starting runtime.
- Do not register memory tools manually: they are attached by `createLanguageEngine` automatically.

Practical integration flow:

1. Add `prisma/memory.prisma` symlink to shared memory schema.
2. Ensure `prisma/schema.prisma` contains generator/datasource and client output to `src/database/_generated`.
3. Add `prisma.config.ts` with `definePrismaConfig()`.
4. In `src/shared/services.ts`, create Prisma client and return it as `prisma` in `services`.
5. In bootstrap, call `runPrismaMigrations(services.pool)` before resource definitions.
6. Call `setupLanguageSubsystem({ services, ... })` without extra memory-tool wiring.

## NLS and Personal Information

- Load `reside-encryption` before changing NLS tools, memory, prompts, tool results, agent tools, or LLM-facing workflows that may touch personal information.
