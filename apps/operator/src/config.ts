export const operatorConfig = {
  controlNamespace: process.env.RESIDE_SYSTEM_NAMESPACE ?? "reside-system",
  reconcileIntervalMs: 5_000,
  replicaApiGroup: "reside.io",
  replicaApiVersion: "v1",
  replicaPlural: "replicas",
}
