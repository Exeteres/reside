---
name: reside-services
description: Use when editing replica service implementations, service factories, src/replica/main.ts wiring, authentication in handlers, runtime dependency composition, or CommonServices dependency wiring.
skill_enforcement:
  patterns:
    - "replicas/*/src/replica/services/**"
    - "replicas/*/src/replica/main.ts"
    - "replicas/*/src/shared/services.ts"
---

# ReSide Service Rules

## Service Placement and Wiring

- Register service implementations directly in `src/replica/main.ts`.
- Use authentication helpers from `@reside/common`, such as `authenticate` and `authenticateReplica`, in service handlers.
- Keep business logic in `src/replica/business/*`.
- `main.ts` should contain only runtime wiring.

## Service Dependency Conventions

- Entry points must keep the full `services` object with `const services = await createServices()`.
- Do not destructure the full `services` object in `src/replica/main.ts` or `src/bootstrap/main.ts`.
- `create*Service` factories must accept a single object argument.
- `create*Service` factories must destructure that object in the function signature using expandable full form, even when there is only one dependency.
- Service factories should type their return value explicitly in the function signature.
- Service factories should return the implementation object directly.
- Methods inside returned service implementation objects should rely on inferred parameter and return types from the declared service implementation return type.

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

## CommonServices

- If a dependency exists in some `CommonServices<...>` API group, factory typing must include and use that `CommonServices` field instead of introducing parallel ad-hoc dependency providers.
- Shared business functions used mostly by business services must accept explicit service/dependency arguments such as `prisma` to keep them easy to test in isolation.
- Do not create non-`@reside/common` broad helper bags unless they are genuinely part of runtime composition.
