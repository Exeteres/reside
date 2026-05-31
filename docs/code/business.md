# Business Logic Style Guide

This document defines the required style for business logic units in ReSide replicas.

## Section purpose

- `src/replica/business` contains units of business logic.
- Business logic may be both: pure data operations or I/O-involving logic.
- Keep business logic separated from runtime wiring (`main.ts`), protocol handlers, and Temporal worker bootstrapping.

## Folder layout

- Business files must be grouped by logical feature scope.
- Required layout:
  - `src/replica/business/{feature}.ts`
  - `src/replica/business/{feature}.test.ts`
- `src/replica/business/index.ts` should only re-export feature modules.

## Function model

- Use functions only for business logic.
- Avoid classes in `src/replica/business`.
- Every business function must accept only positional arguments.
- Do not use object-style `deps`/`services` bags as a single argument in business function signatures.
- If external services are needed, pass each dependency as a dedicated positional argument.

## Business boundary

- Business functions must not perform authentication or authorization identity extraction from transport/runtime context.
- Business functions must not accept RPC handler context objects.
- Business functions must not use generated RPC/gRPC API types (request/response DTOs, handler signatures, service implementation types).
- Business functions must not perform API-specific DTO mapping.
- Business functions must be transport-agnostic and reusable from services, NLS tools, and commands.
- Business functions should own business-level I/O operations (for example: Prisma operations, Temporal communication, external API calls).
- Do not split business logic into tiny callback parameters that already encode business logic (for example: `createSomething`, `startWorkflow`).
- Business functions should accept generic service clients and infrastructure dependencies directly (for example: Prisma client, Temporal client, CommonServices clients, S3/DB clients, HTTP fetch function).
- Service layer is responsible for:
  - authentication and caller identity extraction,
  - protocol/request/response DTO mapping,
  - any API- or transport-specific concerns.

## Dependency injection and testability

- All business logic functions must be mockable and unit-testable.
- Do not mock modules in unit tests.
- Pass external dependencies explicitly into functions (for example: network clients, parsers, repositories, clocks, random generators).
- Prefer narrow dependency parameters (only the required function/client), not broad containers.
- Allow global logger and tracer usage as exceptions for observability.
- Add or update unit tests in `src/replica/business/{feature}.test.ts` immediately when extracting or introducing business functions.
- Use `@reside/common/testing` (`mockDeepFn`, `mockFn`) directly in replica tests.
- Mock all services required by business functions in tests and assert call arguments/results directly.

## Tracing and logging

- Use project-level global logger/tracer for diagnostics.
- Add tracing scopes in business functions when the boundary is meaningful and improves debuggability.
- Keep tracing/logging side effects separate from business return values.
