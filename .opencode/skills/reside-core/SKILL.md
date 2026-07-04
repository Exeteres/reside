---
name: reside-core
description: Use for any work in the ReSide repository. Covers repository basics, README-first workflow, Russian UI text, command restrictions, validation expectations, and scoped skill routing.
skill_enforcement:
  patterns:
    - "AGENTS.md"
    - "README.md"
---

# ReSide Core Rules

## Repository Context

ReSide is an ecosystem of small autonomous agents called replicas.
Replicas implement infrastructure or application behavior and interact with users through CLI, UI, messengers, and APIs.

Replicas live in a Kubernetes cluster, usually one namespace per replica.
Replica services generally use TypeScript/Bun, Prisma ORM, PostgreSQL, Temporal, and gRPC.

## Always-On Rules

- Before doing anything, read `README.md`.
- Before working with a specific replica, read that replica's local documentation if it exists.
- Before writing code, load `reside-typescript`.
- Before writing code for replicas, load `reside-replica`.
- Before making changelog, versioning, release, or commit decisions, load `reside-changes`.
- Before changing code that stores, processes, exposes, logs, routes, encrypts, hashes, decrypts, or sends personal information, load `reside-encryption` and follow it strictly.
- For tasks touching multiple concerns, load all relevant scoped skills and resolve conflicts by choosing the more specific skill.
- Before submitting code changes, verify that each touched area follows its routed skill, not only general TypeScript style.
- Try to use LSP tools to check code first.
- All titles and descriptions in UI must be in Russian.
- All code and comments must be in English.

## Command Rules

- Run `bun`, `nx`, `prisma`, and other dev commands directly.
- Interactive sessions are already launched inside the prepared development shell.
- Do not wrap commands in `devenv shell -- ...` unless the user explicitly asks to test devenv itself.
- Never run `reside bootstrap` unless the user explicitly approves it in the current chat.
- Never run `nx show project` in interactive mode.
- Ensure that `bun ci:check-and-fix` in the project root passes before submitting code changes.

## Skill Tooling

- Load `reside-skills` for skill authoring, skill package, skill script, and `.opencode/skills` workspace rules.

## Interactive Mode Rules

- If you discover that something changed after your edits, stick with the new user-provided changes and do not revert them.
- If LSP gives an error but you are sure it is a false positive, run the relevant `typecheck` script to be sure.

## Skill Routing

- For TypeScript code style, type modeling, aliases, unions, array typing, type references, generics, errors, and logging, load `reside-typescript`.
- For replica structure, boundaries, entrypoints, bootstrap, runtime composition, operations, localization, and e2e layout, load `reside-replica`.
- For operation models, OperationService flows, operation subscriptions, callback payloads, and Reaper action identity, load `reside-operations`.
- For Prisma schema modeling, relations, indexes, configs, migrations, and database generation, load `reside-prisma`.
- For API/protocol work, generated API bindings, gRPC contracts, and protocol design, load `reside-api`.
- For business-layer design, dependency injection for functions, and testability boundaries, load `reside-business`.
- For service implementation patterns, dependency wiring, service factories, and runtime handlers, load `reside-services`.
- For Temporal activity/workflow contracts, names, signals, retry rules, and workflow safety, load `reside-workflows`.
- For NLS subsystem connection, replica NLS tools, LLM boundaries, memory integration, and tool definitions, load `reside-nls`.
- For encryption, personal information storage, decrypted data handling, hashing, NLS/LLM personal information boundaries, and plaintext logging restrictions, load `reside-encryption`.
- For tests, assertions, mocks, business coverage, and e2e scenarios, load `reside-testing`.
- For changelog, versioning, manifest, release, and commit rules, load `reside-changes`.
- For the key rate replica external API and `get_rate` behavior, load `reside-rate-api`.
- For skill authoring, skill packages, skill-owned scripts, and `.opencode/skills` workspace rules, load `reside-skills`.
- For CI commands, root package scripts, Nx targets, and repository check behavior, load `reside-ci`.
- For Engineer replica implementation-phase sessions, issue execution, commits, PR delivery, and deployments, load `reside-engineer`.
