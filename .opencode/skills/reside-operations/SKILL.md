---
name: reside-operations
description: Use when editing replica Operation models, OperationService flows, operation subscription APIs, callback payloads, operation migrations, or Reaper action identity.
skill_enforcement:
  patterns:
    - "replicas/*/prisma/**/operation.prisma"
    - "replicas/*/src/**/operation*.ts"
    - "packages/api/protocols/common/operation.v1.proto"
---

# ReSide Operation Rules

## When To Use

- Use this skill when adding or changing replica operation models.
- Use this skill when adding or changing operation creation, polling, subscription, callback, or completion flows.
- Use this skill when changing operation-related API contracts or Reaper action identity.

## Operation Model Pattern

- Replica operations must use `createGenericOperationService` from `@reside/common`.
- Replica DB must contain exactly one `Operation` entity compatible with the generic helper.
- Keep one `Operation` model per replica.
- Keep generic operation fields compatible with common helpers.
- Define a replica-local `OperationType` enum for every operation-producing flow.
- Require `Operation.type OperationType` on the operation model and set it at every operation creation site.
- `Operation` may contain fields required by the helper, result references, and named operation identity columns.
- Attach feature-specific entities via optional foreign keys and explicit relations.
- Index operation lifecycle queries, such as `@@index([createdAt])` and status-specific indexes where needed.

## Operation Identity And Payloads

- Store identifiers for external operation-related entities in dedicated columns instead of `customData`.
- Examples include Temporal workflow IDs, deterministic idempotency keys, external request IDs, and callback context tokens.
- `customData` is reserved for opaque OperationService subscription payloads passed through to completion callbacks, including callback workflow IDs embedded in that payload.
- Add lookup constraints for operation identifiers, for example `reaperActionId String? @unique`, when idempotency or polling depends on them.
- Reaper action payloads must include surrogate identifiers for replica-related resources, such as numeric database IDs or sorted binding IDs.
- Do not derive action IDs only from stable names like replica names, command names, or resource names, because the same replica name can be recreated with different underlying resources.

## API Compatibility

- Deferred API flows must use `reside.common.operation.v1.Operation` and be compatible with `OperationService` polling and subscription.
- Expose operation subscription API via `createOperationSubscriptionService` when the server supports operation callbacks.

## Migration Safety

- Operation migrations must be deployable on non-empty tables.
- When adding `Operation.type` or any other required field to an existing table, add it nullable, backfill a deterministic value for all existing rows, and then mark it required; alternatively use a database default when that is the correct long-term model.

## Related Skills

- Load `reside-prisma` for Prisma schema and migration workflow rules.
- Load `reside-api` for protocol changes and generated API bindings.
- Load `reside-workflows` when operation completion or callback behavior involves Temporal workflows.
