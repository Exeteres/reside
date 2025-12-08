import type { AlphaData, ReplicaVersion } from "@contracts/alpha.v1"
import type { IPod } from "kubernetes-models/v1"
import type { Logger } from "pino"
import {
  type KubernetesSentinelData,
  updateManagedObjectManifest,
} from "@contracts/kubernetes-sentinel.v1"
import { CommonReplicaConfig, loadConfig } from "@reside/shared"
import { Config } from "./config"
import { getReplicaControlBlock } from "./control-block"

const alphaIdentity = "ghcr.io/exeteres/reside/replicas/alpha"
const kubernetesSentinelIdentity = "ghcr.io/exeteres/reside/replicas/kubernetes-sentinel"

export async function createReplicaSecret(
  k8s: KubernetesSentinelData,
  replicaName: string,
  accountId: string,
  agentSecret: string,
) {
  const loadedK8s = await k8s.$jazz.ensureLoaded({
    resolve: {
      secrets: true,
    },
  })

  loadedK8s.secrets.$jazz.set(replicaName, {
    name: replicaName,
    status: "requested",

    manifest: {
      apiVersion: "v1",
      kind: "Secret",

      type: "Opaque",
      stringData: {
        accountId,
        agentSecret,
      },
    },
  })
}

export async function syncReplicaVersionWorkload(
  data: AlphaData,
  k8s: KubernetesSentinelData,
  replicaVersion: ReplicaVersion,
  logger: Logger,
): Promise<void> {
  const loadedK8s = await k8s.$jazz.ensureLoaded({
    resolve: {
      deployments: { $each: { $onError: "catch" } },
      jobs: { $each: { $onError: "catch" } },
    },
  })

  const loadedVersion = await replicaVersion.$jazz.ensureLoaded({
    resolve: {
      replica: true,
    },
  })

  const config = loadConfig(CommonReplicaConfig)
  const alphaConfig = loadConfig(Config)

  const labels = {
    "reside.io/replica": loadedVersion.replica.name,
    "reside.io/version": loadedVersion.id.toString(),
  }

  const workloadName = `${loadedVersion.replica.name}-${loadedVersion.id}`
  const controlBlock = await getReplicaControlBlock(data, loadedVersion.replica)

  const podTemplate: Pick<IPod, "metadata" | "spec"> = {
    metadata: { labels },

    spec: {
      serviceAccount:
        // attach sentinel SA if running Kubernetes Sentinel
        loadedVersion.replica.identity === kubernetesSentinelIdentity
          ? "kubernetes-sentinel"
          : undefined,

      containers: [
        {
          name: loadedVersion.replica.name,
          image: `${loadedVersion.replica.identity}@${loadedVersion.digest}`,
          imagePullPolicy: "IfNotPresent" as const,
          env: [
            ...(loadedVersion.replica.identity === alphaIdentity
              ? // add some environment variables only for Alpha Replica
                [
                  {
                    name: "RESIDE_DOMAIN",
                    value: alphaConfig.RESIDE_DOMAIN ?? "",
                  },
                  {
                    name: "RESIDE_CLUSTER_ISSUER",
                    value: alphaConfig.RESIDE_CLUSTER_ISSUER ?? "",
                  },
                ]
              : []),
            ...(loadedVersion.replica.identity === kubernetesSentinelIdentity
              ? // add some environment variables only for Kubernetes Sentinel
                [
                  {
                    name: "RESIDE_NAMESPACE",
                    valueFrom: {
                      fieldRef: {
                        fieldPath: "metadata.namespace",
                      },
                    },
                  },
                  // TODO: investigate why this is needed - some bug in bun/k8s client?
                  {
                    name: "NODE_TLS_REJECT_UNAUTHORIZED",
                    value: "0",
                  },
                ]
              : []),
            {
              name: "RESIDE_CONTROL_BLOCK_ID",
              value: controlBlock.$jazz.id,
            },
            {
              name: "RESIDE_ACCOUNT_ID",
              valueFrom: {
                secretKeyRef: {
                  name: loadedVersion.replica.name,
                  key: "accountId",
                },
              },
            },
            {
              name: "RESIDE_AGENT_SECRET",
              valueFrom: {
                secretKeyRef: {
                  name: loadedVersion.replica.name,
                  key: "agentSecret",
                },
              },
            },
            {
              name: "RESIDE_SYNC_SERVER_URL",
              value: config.RESIDE_SYNC_SERVER_URL,
            },
            {
              name: "RESIDE_ETCD_HOSTS",
              value: config.RESIDE_ETCD_HOSTS,
            },
            {
              name: "RESIDE_EXTERNAL_ENDPOINT",
              value: config.RESIDE_EXTERNAL_ENDPOINT,
            },
            {
              name: "RESIDE_ACCESS_CONTEXT",
              value: config.RESIDE_ACCESS_CONTEXT,
            },
          ],
        },
      ],
    },
  }

  if (loadedVersion.replica.info.class === "long-running") {
    updateManagedObjectManifest(loadedK8s.deployments, workloadName, {
      apiVersion: "apps/v1",
      kind: "Deployment",

      spec: {
        selector: { matchLabels: labels },
        template: podTemplate,

        // for scalable replicas, start with 1 replica
        // for non-scalable replicas, start with 0 replicas and let deployment reconciler start it when old version is down
        replicas: loadedVersion.replica.info.scalable ? 1 : 0,
      },
    })
  } else {
    updateManagedObjectManifest(loadedK8s.jobs, workloadName, {
      apiVersion: "batch/v1",
      kind: "Job",

      spec: {
        template: podTemplate,
      },
    })
  }

  logger.info(
    `synchronized workload for replica "%s" version "%d"`,
    loadedVersion.replica.name,
    loadedVersion.id,
  )
}

export async function syncReplicaVersionServiceAndIngress(
  k8s: KubernetesSentinelData,
  replicaVersion: ReplicaVersion,
  logger: Logger,
): Promise<void> {
  const loadedVersion = await replicaVersion.$jazz.ensureLoaded({
    resolve: {
      replica: true,
      implementations: {
        $each: {
          methods: true,
        },
      },
    },
  })

  let hasMethods = false
  for (const imlp of Object.values(loadedVersion.implementations)) {
    if (imlp?.methods && Object.values(imlp.methods).length > 0) {
      hasMethods = true
      break
    }
  }

  const loadedK8s = await k8s.$jazz.ensureLoaded({
    resolve: {
      services: { $each: { $onError: "catch" } },
      ingresses: { $each: { $onError: "catch" } },
    },
  })

  const config = loadConfig(Config)

  // do not set version here to allow service to match all versions
  const labels = {
    "reside.io/replica": loadedVersion.replica.name,
  }

  const serviceName = loadedVersion.replica.name

  updateManagedObjectManifest(
    loadedK8s.services,
    serviceName,
    hasMethods
      ? {
          apiVersion: "v1",
          kind: "Service",

          spec: {
            selector: labels,
            ports: [
              {
                protocol: "TCP",
                port: 80,
                targetPort: 8080,
              },
            ],
            type: "ClusterIP",
          },
        }
      : null,
  )

  updateManagedObjectManifest(
    loadedK8s.ingresses,
    serviceName,
    hasMethods
      ? {
          apiVersion: "networking.k8s.io/v1",
          kind: "Ingress",

          metadata: {
            annotations: config.RESIDE_DOMAIN
              ? { "cert-manager.io/cluster-issuer": config.RESIDE_CLUSTER_ISSUER! }
              : undefined,
          },

          spec: {
            rules: [
              {
                http: {
                  paths: [
                    {
                      pathType: "Prefix",
                      path: `/replicas/${loadedVersion.replica.name}/`,
                      backend: {
                        service: {
                          name: serviceName,
                          port: {
                            number: 80,
                          },
                        },
                      },
                    },
                  ],
                },
              },
            ],
            tls: config.RESIDE_DOMAIN
              ? [{ hosts: [config.RESIDE_DOMAIN], secretName: "tls" }]
              : undefined,
          },
        }
      : null,
  )

  logger.info(`synchronized service and ingress for replica "%s"`, loadedVersion.replica.name)
}
