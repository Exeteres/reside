# Agent Handbook

Some simple rules to follow:

- Before doing anything, read `README.md`.
- Before working with some specific replicas, read their docs in `replicas/*/README.md`.
- Before writing code, read `docs/code/style.md`.
- Before changing code that stores, processes, exposes, logs, or routes personal information, read `docs/code/encryption.md` and follow it strictly.
- Before writing code for replicas, read `docs/replica.md` and follow the defined structure and patterns.
- When implementing new replica or API, follow the structure and patterns of existing replicas and APIs as closely as possible.
- Try to use LSP tools to check your code first.
- All titles/descriptions in UI in the project must be in Russian, but all code and comments must be in English.
- After each meaningful change in a replica, update its version and changelog using `scripts/update-version.ts`.
- Dependency-only changes (packages or other replicas) must not cause a replica version bump.
- Backward-incompatible (major) changes are forbidden, and major version bumps are forbidden as well.

Rule routing (load additional rules by situation):

- For type modeling, aliases, unions, array typing, type references, and generics, load `docs/code/types.md`.
- For error creation, wrapping, error taxonomy, and workflow error handling, load `docs/code/errors.md`.
- For logging format, structured logging conventions, and error logging shape, load `docs/code/logging.md`.
- For encryption, personal information storage, decrypted data handling, hashing requirements, NLS/LLM personal information boundaries, and plaintext logging restrictions, load `docs/code/encryption.md`.
- For service implementation patterns, dependency wiring, and service factory conventions, load `docs/code/services.md`.
- For Temporal activity/workflow contracts, naming, signals, and retry/error patterns, load `docs/code/workflows.md`.
- For business-layer design, dependency injection for functions, and testability/mocking boundaries, load `docs/code/business.md`.
- For NLS subsystem connection, replica NLS tool layout, and tool factory/definition rules, load `docs/code/nls.md`.
- For replica structure, boundaries, entrypoints, and composition rules, load `docs/replica.md`.
- For Prisma schema modeling, relations, indexes, configs, and migration naming/workflow, load `docs/design/prisma.md`.
- For API/protocol work, additionally load `docs/design/api.md` and follow existing protocol/generated code patterns.
- For any code that may touch personal information, load `docs/code/encryption.md` even when the primary task is Prisma, business logic, services, logging, NLS, workflows, API, or tests.
- For tasks touching multiple concerns, load all relevant rule files above before editing and resolve conflicts by choosing the more specific rule document.
- Before submitting code changes, verify that each touched area follows its routed rule documents, not only `docs/code/style.md`.

In interactive mode, follow these additional rules:

- If you discovered that something changed after your edits, stick with the new (user-provided) changes and do not revert them.
- If LSP gives you an error, but you are sure it's a false positive, run `typecheck` script in the project to be sure.
- Ensure that `bun ci:check-and-fix` in the project root passes before submitting your code.
- Never run `reside bootstrap` unless the user explicitly approves it in the current chat.
- Never run `nx show project` in interactive mode.

Commit instructions:

- Use Conventional Commits for all commit messages.
- Keep commit messages lowercased, as a single line string, without extra details.
- Group changes logically and create separate commits for separate logical changes.
- For commit scope, use package or replica names when a commit affects a single package/replica.
- If one logical change affects multiple packages/replicas, omit scope.
