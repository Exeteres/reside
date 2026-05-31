# API Conventions

## Contract Source Of Truth

- Define contracts only in [packages/api/protocols](packages/api/protocols).
- Never edit generated files in [packages/api/src/\_generated](packages/api/src/_generated).
- After proto changes, run generation from [packages/api/package.json](packages/api/package.json) (`bun run generate`).

## File And Package Structure

- Keep API domains under existing groups: `access`, `alpha`, `common`, `infra`, `interaction`.
- Use package names as `reside.<domain>.<feature>.v1`.
- Keep one feature per proto file (`<feature>.v1.proto`).

## Message And RPC Design

- Use explicit `*Request` / `*Response` messages for non-empty payloads.
- For empty payloads, use `google.protobuf.Empty` (both request and response where applicable), and never introduce custom empty messages.

## Optionality And Presence

- Use wrappers (`google.protobuf.StringValue`, `BoolValue`, etc.) for nullable scalar business fields.
- Use `optional` scalar only when presence itself is the contract and wrapper semantics are not needed.
- Keep repeated fields as empty lists by default; do not wrap repeated values.

## Non-Obvious Stability Rules

- External IDs/tokens that clients should not inspect must be opaque strings and explicitly documented as opaque.
- If a value can be either immediate or deferred, model it as `oneof { result | operation }`.
- Deferred flows must use `reside.common.operation.v1.Operation` and be compatible with `OperationService` polling/subscription.
- Callback endpoints must include the expected service contract in comments (what service the endpoint must implement).
- Idempotent write RPCs must state idempotency in comments.

## Type Choices

- Use `google.protobuf.Struct` for flexible JSON-like payloads.
- Use `google.type.DateTime` for API timestamps.
- Use enums for closed sets; keep zero value as safe default (`*_UNSPECIFIED` or explicit neutral value like `NONE`).

## Naming

- Proto field names: `snake_case`.
- RPC names: verb-first and precise (`PutRealm`, `GetOperation`, `InvokeCommand`).
- Avoid leaking storage/internal model terms into public contract names.

## Comments Quality Bar

- Comments must describe contract semantics, not implementation.
- Required to document: opaque values, async result behavior, authorization-sensitive behavior, idempotency, callback expectations.

## Existing Patterns To Follow

- Empty request/response: [packages/api/protocols/common/ping.v1.proto](packages/api/protocols/common/ping.v1.proto)
- Empty response on command-style RPC: [packages/api/protocols/alpha/load.v1.proto](packages/api/protocols/alpha/load.v1.proto)
- Result-or-operation `oneof`: [packages/api/protocols/infra/provision.v1.proto](packages/api/protocols/infra/provision.v1.proto)
- Opaque token and opaque notification IDs: [packages/api/protocols/interaction/notification.v1.proto](packages/api/protocols/interaction/notification.v1.proto)
- Shared operation contract: [packages/api/protocols/common/operation.v1.proto](packages/api/protocols/common/operation.v1.proto)

## Minimal Change Checklist

1. Update proto in [packages/api/protocols](packages/api/protocols).
2. Apply rules above (especially Empty/wrappers/oneof/opaque semantics).
3. Regenerate bindings.
4. Typecheck impacted packages.
