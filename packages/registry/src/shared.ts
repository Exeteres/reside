export type Replica<
  TName extends string = string,
  // biome-ignore lint/suspicious/noExplicitAny: allow any to suppress circular type reference
  TDependencyReplicas extends Record<string, Replica> = Record<string, any>,
  TOptionalDependencyReplicas extends Record<string, Replica | (() => Replica)> = Record<
    string,
    // biome-ignore lint/suspicious/noExplicitAny: allow any to suppress circular type reference
    any
  >,
  TDependencyEndpoints extends Record<string, string> = Record<string, string>,
  TSecrets extends Record<string, Record<string, unknown>> = Record<
    string,
    Record<string, unknown>
  >,
  TConfigMaps extends Record<string, Record<string, unknown>> = Record<
    string,
    Record<string, unknown>
  >,
> = {
  name: TName
  image: string
  endpoint: string
  endpoints: TDependencyEndpoints &
    Record<keyof TDependencyReplicas, string> &
    Record<keyof TOptionalDependencyReplicas, string>
  dependencies: {
    replicas: TDependencyReplicas
    endpoints: TDependencyEndpoints
  }
  optionalDependencies: {
    replicas: TOptionalDependencyReplicas
  }
  secrets: TSecrets
  configMaps: TConfigMaps
  bootstrapClusterRoleRules: RoleRule[]
  clusterRoleRules: RoleRule[]
}

export type RoleRule = {
  apiGroups: string[]
  resources: string[]
  verbs: string[]
  resourceNames?: string[]
}

export type ReplicaOptions<
  TName extends string,
  TDependencyReplicas extends Record<string, Replica>,
  TOptionalDependencyReplicas extends Record<string, Replica | (() => Replica)>,
  TDependencyEndpoints extends Record<string, string>,
  TSecrets extends Record<string, Record<string, unknown>> = Record<
    string,
    Record<string, unknown>
  >,
  TConfigMaps extends Record<string, Record<string, unknown>> = Record<
    string,
    Record<string, unknown>
  >,
> = {
  name: TName
  image?: string
  endpoint?: string
  dependencies?: {
    replicas?: TDependencyReplicas
    endpoints?: TDependencyEndpoints
  }
  optionalDependencies?: {
    replicas?: TOptionalDependencyReplicas
  }
  secrets?: TSecrets
  configMaps?: TConfigMaps
  bootstrapClusterRoleRules?: RoleRule[]
  clusterRoleRules?: RoleRule[]
}

export function wellKnownReplicaEndpoint(name: string): string {
  return `${name}.replica-${name}.svc.cluster.local`
}

export function defineReplica<
  TName extends string,
  TDependencyReplicas extends Record<string, Replica> = Record<string, never>,
  TOptionalDependencyReplicas extends Record<string, Replica | (() => Replica)> = Record<
    string,
    never
  >,
  TDependencyEndpoints extends Record<string, string> = Record<string, never>,
>(
  config: ReplicaOptions<
    TName,
    TDependencyReplicas,
    TOptionalDependencyReplicas,
    TDependencyEndpoints
  >,
): Replica<TName, TDependencyReplicas, TOptionalDependencyReplicas, TDependencyEndpoints> {
  const endpoint = config.endpoint ?? wellKnownReplicaEndpoint(config.name)
  let endpointsCache:
    | (TDependencyEndpoints &
        Record<keyof TDependencyReplicas, string> &
        Record<keyof TOptionalDependencyReplicas, string>)
    | null = null

  const staticEndpoints = {
    ...config.dependencies?.endpoints,
    // biome-ignore lint/suspicious/noExplicitAny: allow any to simplify implementation
  } as any

  const replica: Replica<
    TName,
    TDependencyReplicas,
    TOptionalDependencyReplicas,
    TDependencyEndpoints
  > = {
    name: config.name,
    image: config.image ?? `ghcr.io/exeteres/reside/replicas/${config.name}`,
    endpoint,
    get endpoints() {
      if (endpointsCache !== null) {
        return endpointsCache
      }

      endpointsCache = resolveAllEndpoints(replica)

      return endpointsCache
    },
    dependencies: {
      replicas: config.dependencies?.replicas ?? ({} as TDependencyReplicas),

      endpoints: staticEndpoints,
    },
    optionalDependencies: {
      replicas: config.optionalDependencies?.replicas ?? ({} as TOptionalDependencyReplicas),
    },
    secrets: config.secrets ?? ({} as Record<string, Record<string, unknown>>),
    configMaps: config.configMaps ?? ({} as Record<string, Record<string, unknown>>),
    bootstrapClusterRoleRules: config.bootstrapClusterRoleRules ?? [],
    clusterRoleRules: config.clusterRoleRules ?? [],
  }

  return replica
}

type ResolvedOptionalDependencies<
  TOptionalDependencyReplicas extends Record<string, Replica | (() => Replica)>,
> = {
  [K in keyof TOptionalDependencyReplicas]: TOptionalDependencyReplicas[K] extends () => Replica
    ? ReturnType<TOptionalDependencyReplicas[K]>
    : TOptionalDependencyReplicas[K]
}

/**
 * Resolves optional dependencies for a given replica, evaluating any function-based dependencies.
 *
 * @param replica The replica for which to resolve optional dependencies.
 * @returns An object containing the resolved optional dependencies.
 */
export function getOptionalDependencies<T extends Replica>(
  replica: T,
): ResolvedOptionalDependencies<T["optionalDependencies"]["replicas"]> {
  const resolvedReplicas = {} as Record<string, Replica>

  for (const [key, value] of Object.entries(replica.optionalDependencies.replicas)) {
    resolvedReplicas[key] =
      typeof value === "function" ? (value as () => Replica)() : (value as Replica)
  }

  return resolvedReplicas as ResolvedOptionalDependencies<T["optionalDependencies"]["replicas"]>
}

/**
 * Resolves all dependencies for a given replica, including optional dependencies.
 *
 * @param replica The replica for which to resolve dependencies.
 * @returns An object containing all resolved dependencies.
 */
export function getAllDependencies<T extends Replica>(
  replica: T,
): T["dependencies"]["replicas"] &
  ResolvedOptionalDependencies<T["optionalDependencies"]["replicas"]> {
  const optionalReplicas = getOptionalDependencies(replica)

  return {
    ...replica.dependencies.replicas,
    ...optionalReplicas,
  }
}

/**
 * Resolves all dependency endpoints for a replica, including endpoints for optional replica dependencies.
 *
 * @param replica The replica for which to resolve endpoint dependencies.
 * @returns A map of dependency endpoint names to endpoint addresses.
 */
function resolveAllEndpoints<T extends Replica>(replica: T): T["endpoints"] {
  const allDependencies = getAllDependencies(replica)
  const endpoints = { ...replica.dependencies.endpoints } as Record<string, string>

  for (const [name, dependencyReplica] of Object.entries(allDependencies)) {
    if (Object.hasOwn(endpoints, name)) {
      continue
    }

    endpoints[name] = dependencyReplica.endpoint
  }

  return endpoints as T["endpoints"]
}
