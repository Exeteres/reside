# NLS Subsystem Style Guide

This document defines required rules for connecting `setupLanguageSubsystem` and implementing replica-specific NLS tools.

## Mandatory replica integration

- Every replica must call `setupLanguageSubsystem` in `src/replica/main.ts` as part of runtime wiring.
- Keep the call close to server route setup so NLS connectivity is explicit in composition.
- Pass localized `title` and `description` from replica locale.
- Provide a replica-specific `mission` string.

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
