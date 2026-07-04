---
name: reside-api
description: Use when editing API protocols under packages/api/protocols, generated API bindings, gRPC/Connect service contracts, request/response DTOs, operation-based API flows, or protocol generation.
enforcement:
  files:
    - "packages/api/protocols/**"
    - "packages/api/src/_generated/**"
---

# ReSide API Rules

## Contract Source of Truth

- Define contracts only in `packages/api/protocols`.
- Never edit generated files in `packages/api/src/_generated`.
- After proto changes, run generation from `packages/api/package.json` with `bun run generate`.

## File and Package Structure

- Keep API domains under existing groups: `access`, `alpha`, `common`, `infra`, `interaction`.
- Use package names as `reside.<domain>.<feature>.v1`.
- Keep one feature per proto file as `<feature>.v1.proto`.

## Message and RPC Design

- Use explicit `*Request` and `*Response` messages for non-empty payloads.
- For empty payloads, use `google.protobuf.Empty` for request and response where applicable.
- Never introduce custom empty messages.

## Optionality and Presence

- Use wrappers such as `google.protobuf.StringValue` and `BoolValue` for nullable scalar business fields.
- Use `optional` scalar only when presence itself is the contract and wrapper semantics are not needed.
- Keep repeated fields as empty lists by default; do not wrap repeated values.

## Non-Obvious Stability Rules

- External IDs or tokens that clients should not inspect must be opaque strings and explicitly documented as opaque.
- If a value can be either immediate or deferred, model it as `oneof { result | operation }`.
- Deferred flows must follow `reside-operations` API compatibility rules.
- Callback endpoints must include the expected service contract in comments, describing what service the endpoint must implement.
- Idempotent write RPCs must state idempotency in comments.

## Type Choices

- Use `google.protobuf.Struct` for flexible JSON-like payloads.
- Use `google.type.DateTime` for API timestamps.
- Use enums for closed sets.
- Keep enum zero value as a safe default, such as `*_UNSPECIFIED` or an explicit neutral value like `NONE`.

## Naming

- Proto field names use `snake_case`.
- RPC names are verb-first and precise, such as `PutRealm`, `GetOperation`, or `InvokeCommand`.
- Avoid leaking storage/internal model terms into public contract names.

## Comments Quality Bar

- Comments must describe contract semantics, not implementation.
- Required comment topics: opaque values, async result behavior, authorization-sensitive behavior, idempotency, and callback expectations.

## Existing Patterns To Follow

- Empty request/response: `packages/api/protocols/common/ping.v1.proto`.
- Empty response on command-style RPC: `packages/api/protocols/alpha/load.v1.proto`.
- Result-or-operation `oneof`: `packages/api/protocols/infra/provision.v1.proto`.
- Opaque token and opaque notification IDs: `packages/api/protocols/interaction/notification.v1.proto`.
- Shared operation contract: `packages/api/protocols/common/operation.v1.proto`.

## Minimal Change Checklist

1. Update proto in `packages/api/protocols`.
2. Apply API rules, especially `Empty`, wrappers, `oneof`, and opaque semantics.
3. Regenerate bindings.
4. Typecheck impacted packages.
