function readClusterDomain(): string {
  const value = process.env.RESIDE_CLUSTER_DOMAIN?.trim()
  if (value && value.length > 0) {
    return value
  }

  return "cluster.local"
}

export const operatorConfig = {
  controlNamespace: process.env.RESIDE_SYSTEM_NAMESPACE ?? "reside-system",
  clusterDomain: readClusterDomain(),
  reconcileIntervalMs: 5_000,
  replicaApiGroup: "reside.io",
  replicaApiVersion: "v1",
  replicaPlural: "replicas",
}
