---
name: reside-business
description: Use when editing src/replica/business code, extracting business functions, dependency injection, unit-testable logic, transport-agnostic behavior, or business-layer side effects.
enforcement:
  files:
    - "replicas/*/src/replica/business/**"
---

# ReSide Business Logic Rules

## Required First Steps

- Identify the feature file under `src/replica/business`.
- Inspect the corresponding business test file before changing behavior.
- Load `reside-testing` when adding or changing business behavior.
- Load `reside-encryption` when personal information, ECIDs, RHIDs, encryption, or decrypted data may flow through the business function.

## Working Pattern

1. Keep transport-specific behavior outside the business function.
2. Pass external dependencies explicitly.
3. Implement the smallest business boundary that owns the behavior.
4. Update or add focused business tests for changed behavior when reasonable.
5. Let service, NLS, command, or workflow layers map transport DTOs to business inputs.

## Section Purpose

- `src/replica/business` contains units of business logic.
- Business logic may be pure data operations or I/O-involving logic.
- Keep business logic separated from runtime wiring in `main.ts`, protocol handlers, and Temporal worker bootstrapping.

## Folder Layout

- Business files must be grouped by logical feature scope.
- Use `src/replica/business/{feature}.ts`.
- Use `src/replica/business/{feature}.test.ts`.
- `src/replica/business/index.ts` should only re-export feature modules.

## Function Model

- Use functions only for business logic.
- Avoid classes in `src/replica/business`.
- Every business function must accept only positional arguments.
- Do not use object-style `deps` or `services` bags as a single argument in business function signatures.
- If external services are needed, pass each dependency as a dedicated positional argument.

## Business Boundary

- Business functions must not perform authentication or authorization identity extraction from transport/runtime context.
- Business functions must not accept RPC handler context objects.
- Business functions must not use generated RPC/gRPC API types such as request/response DTOs, handler signatures, or service implementation types.
- Business functions must not perform API-specific DTO mapping.
- Business functions must be transport-agnostic and reusable from services, NLS tools, and commands.
- Business functions should own business-level I/O operations such as Prisma operations, Temporal communication, and external API calls.
- Do not split business logic into tiny callback parameters that already encode business logic, such as `createSomething` or `startWorkflow`.
- Business functions should accept generic service clients and infrastructure dependencies directly, such as Prisma client, Temporal client, CommonServices clients, S3/DB clients, or HTTP fetch function.

The service layer is responsible for:

- authentication and caller identity extraction;
- protocol/request/response DTO mapping;
- API-specific or transport-specific concerns.

## Dependency Injection and Testability

- All business logic functions must be mockable and unit-testable.
- Do not mock modules in unit tests.
- Pass external dependencies explicitly into functions, such as network clients, parsers, repositories, clocks, and random generators.
- Prefer narrow dependency parameters that include only the required function/client, not broad containers.
- Global logger and tracer usage is allowed as an observability exception.
- Add or update unit tests in `src/replica/business/{feature}.test.ts` immediately when extracting or introducing business functions.
- Use `@reside/common/testing` helpers such as `mockDeepFn` and `mockFn` directly in replica tests.
- Mock all services required by business functions in tests and assert call arguments/results directly.

## Encryption Dependency Rule

- Load `reside-encryption` for encryption dependency and personal-information handling rules.

## Tracing and Logging

- Use project-level global logger/tracer for diagnostics.
- Add tracing scopes in business functions when the boundary is meaningful and improves debuggability.
- Keep tracing/logging side effects separate from business return values.
- Load `reside-encryption` before logging or tracing values that may include personal information.

## Stop And Ask

- Stop if a business function appears to require RPC context or generated API DTOs directly.
- Stop if plaintext personal information appears necessary; load `reside-encryption` and redesign the boundary.

## Validation

- Run focused business tests for changed behavior when practical.
- Run typecheck for the touched package when signatures or dependencies changed.

## Review Checklist

- Business functions are transport-agnostic.
- Dependencies are explicit positional arguments.
- Tests cover meaningful changed branches when reasonable.
- Related skills were loaded for encryption, testing, workflows, Prisma, or API concerns.
