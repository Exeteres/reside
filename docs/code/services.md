# Service Implementation Style Guide

This document defines required service implementation patterns in ReSide replicas.

## Service placement and wiring

- Register service implementations directly in `src/replica/main.ts`.
- Use authentication helpers from `@reside/common` (`authenticate`, `authenticateReplica`) in service handlers.
- Keep business logic in `src/replica/business/*`, while `main.ts` should contain only runtime wiring.

## Service dependency conventions

- Entry points must keep the full `services` object (`const services = await createServices()`) and should not destructure it in `src/replica/main.ts` and `src/bootstrap/main.ts`.
- `create*Service` factories must accept a single object argument and must destructure it in the function signature using expandable full form, even when there is only one dependency.
- Service factories should type their return value explicitly in the function signature and return the implementation object directly.
- Methods inside returned service implementation objects should rely on inferred parameter/return types from the declared service implementation return type.

Required signature style:

```typescript
export function createBindingService({
  prisma,
}: {
  prisma: PrismaClient;
}): BindingServiceImplementation {
  return {
    async getBinding(request, context) {
      // ...
    },
  };
}
```

- If a dependency exists in some `CommonServices<...>` API group, factory typing must include and use that `CommonServices` field instead of introducing parallel ad-hoc dependency providers.
- Shared business functions used mostly by business services (non-`@reside/common` helpers) must accept explicit service/dependency arguments (for example `prisma`) to keep them easy to test in isolation.
