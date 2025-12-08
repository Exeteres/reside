import type { IStatefulSet } from "kubernetes-models/apps/v1"
import type { IPersistentVolumeClaim, IService } from "kubernetes-models/v1"
import {
  AppsV1Api,
  type AppsV1ApiCreateNamespacedStatefulSetRequest,
  CoreV1Api,
  type CoreV1ApiCreateNamespacedPersistentVolumeClaimRequest,
  type CoreV1ApiCreateNamespacedServiceRequest,
  KubeConfig,
  type V1ExecAction,
} from "@kubernetes/client-node"
import {
  AlphaReplica,
  createLoadRequest,
  createReplicaControlBlockIndex,
  createReplicaVersionFromLoadRequest,
  validateLoadRequest,
} from "@replicas/alpha"
import { ClusterAlpha, KubernetesSentinel, objectTypes } from "@replicas/kubernetes-sentinel"
import { loadConfig, ReplicaControlBlock } from "@reside/shared"
import { startReplica } from "@reside/shared/node"
import { type Account, co, Group } from "jazz-tools"
import { setActiveAccount } from "jazz-tools/testing"
import { pino } from "pino"
import { Config } from "./config"
import { createWorkerAccount, extractIpv4Address, isAlreadyExists } from "./utils"

const logger = pino()
const config = loadConfig(Config)

const kc = new KubeConfig()
kc.loadFromDefault()

const fieldManager = "kubernetes-sentinel"

const kubeApiHost = kc.getCurrentCluster()?.server
if (!kubeApiHost) {
  throw new Error("Failed to get current cluster from kubeconfig")
}

const kubeApiIp = extractIpv4Address(kubeApiHost)
if (!kubeApiIp) {
  throw new Error(`Failed to extract IPv4 address from kube API host: ${kubeApiHost}`)
}

logger.info(`Kubernetes API IPv4: "%s"`, kubeApiIp)

// phase 1. jazz setup

const coreV1 = kc.makeApiClient(CoreV1Api)
const appsV1 = kc.makeApiClient(AppsV1Api)

const jazzLabels = {
  "app.kubernetes.io/name": "jazz",

  // to let kubernetes-sentinel accept this resource as managed
  "app.kubernetes.io/managed-by": "kubernetes-sentinel",
}

const etcdLabels = {
  "app.kubernetes.io/name": "etcd",

  // to let kubernetes-sentinel accept this resource as managed
  "app.kubernetes.io/managed-by": "kubernetes-sentinel",
}

const jazzPort = 4200
const etcdPort = 2379

const jazzUrl = `ws://jazz:${jazzPort}`
const etcdUrl = `http://etcd:${etcdPort}`

// 1. create jazz service if not exists
const jazzServiceBody: CoreV1ApiCreateNamespacedServiceRequest["body"] = {
  metadata: {
    name: "jazz",
    labels: jazzLabels,
  },
  spec: {
    selector: jazzLabels,
    type: "ClusterIP",
    ports: [
      {
        protocol: "TCP",
        port: jazzPort,
        targetPort: jazzPort,
      },
    ],
  },
}

try {
  await coreV1.createNamespacedService({
    namespace: config.RESIDE_NAMESPACE,
    fieldManager,
    body: jazzServiceBody,
  })

  logger.info("successfully created Service for jazz")
} catch (err) {
  if (!isAlreadyExists(err)) {
    throw new Error("Failed to create Service for jazz", { cause: err })
  }

  logger.info("Service for jazz already exists")
}

// 1.2. create Jazz PVC if not exists

const jazzVolumeClaimTemplate: CoreV1ApiCreateNamespacedPersistentVolumeClaimRequest["body"] = {
  metadata: {
    name: "jazz-data",
    labels: jazzLabels,
  },
  spec: {
    accessModes: ["ReadWriteOnce"],
    resources: { requests: { storage: "1Gi" } },
  },
}

try {
  await coreV1.createNamespacedPersistentVolumeClaim({
    namespace: config.RESIDE_NAMESPACE,
    fieldManager,
    body: jazzVolumeClaimTemplate,
  })

  logger.info("successfully created PersistentVolumeClaim for jazz")
} catch (err) {
  if (!isAlreadyExists(err)) {
    throw new Error("Failed to create PersistentVolumeClaim for jazz", { cause: err })
  }

  logger.info("PersistentVolumeClaim for jazz already exists")
}

const nodeSelector = config.RESIDE_DEFAULT_PLACEMENT_GROUP
  ? { "reside.io/placement-group": config.RESIDE_DEFAULT_PLACEMENT_GROUP }
  : undefined

// 1.3. create Jazz StatefulSet with PVC if not exists
const jazzExec: V1ExecAction = {
  command: ["wscat", "--connect", `ws://localhost:${jazzPort}`, "-x", "{}"],
}

const jazzStatefulSetBody: AppsV1ApiCreateNamespacedStatefulSetRequest["body"] = {
  metadata: {
    name: "jazz",
    labels: jazzLabels,
  },
  spec: {
    serviceName: "jazz",
    replicas: 1,
    selector: { matchLabels: jazzLabels },
    template: {
      metadata: {
        labels: jazzLabels,
      },
      spec: {
        nodeSelector,
        containers: [
          {
            name: "jazz",
            image: "ghcr.io/exeteres/reside/jazz:latest",
            ports: [
              {
                containerPort: jazzPort,
                protocol: "TCP",
              },
            ],
            volumeMounts: [
              {
                name: "jazz-data",
                mountPath: "/data",
              },
            ],
            livenessProbe: {
              exec: jazzExec,
            },
            startupProbe: {
              exec: jazzExec,
              initialDelaySeconds: 1,
            },
          },
        ],
        volumes: [{ name: "jazz-data", persistentVolumeClaim: { claimName: "jazz-data" } }],
      },
    },
  },
}

try {
  await appsV1.createNamespacedStatefulSet({
    namespace: config.RESIDE_NAMESPACE,
    fieldManager,
    body: jazzStatefulSetBody,
  })

  logger.info("successfully created StatefulSet for jazz")
} catch (err) {
  if (!isAlreadyExists(err)) {
    throw new Error("Failed to create StatefulSet for jazz", { cause: err })
  }

  logger.info("StatefulSet for jazz already exists")
}

// 1.4. create etcd service if not exists
const etcdServiceBody: CoreV1ApiCreateNamespacedServiceRequest["body"] = {
  metadata: {
    name: "etcd",
    labels: etcdLabels,
  },
  spec: {
    selector: etcdLabels,
    ports: [
      {
        protocol: "TCP",
        port: etcdPort,
        targetPort: etcdPort,
      },
    ],
  },
}

try {
  await coreV1.createNamespacedService({
    namespace: config.RESIDE_NAMESPACE,
    fieldManager,
    body: etcdServiceBody,
  })
  logger.info("successfully created Service for etcd")
} catch (err) {
  if (!isAlreadyExists(err)) {
    throw new Error("Failed to create Service for etcd", { cause: err })
  }

  logger.info("Service for etcd already exists")
}

// 1.5. create etcd StatefulSet if not exists
const etcdExec: V1ExecAction = {
  command: ["etcdctl", `--endpoints=http://localhost:${etcdPort}`, "auth", "status"],
}

const etcdStatefulSetBody: AppsV1ApiCreateNamespacedStatefulSetRequest["body"] = {
  metadata: {
    name: "etcd",
    labels: etcdLabels,
  },
  spec: {
    serviceName: "etcd",
    replicas: 1,
    selector: { matchLabels: etcdLabels },
    template: {
      metadata: {
        labels: etcdLabels,
      },
      spec: {
        nodeSelector,
        containers: [
          {
            name: "etcd",
            image: "quay.io/coreos/etcd:v3.6.5",
            command: ["etcd"],
            args: [
              "-listen-client-urls",
              `http://0.0.0.0:${etcdPort}`,
              "-advertise-client-urls",
              etcdUrl,
            ],
            ports: [
              {
                containerPort: etcdPort,
                protocol: "TCP",
              },
            ],
            livenessProbe: {
              exec: etcdExec,
            },
            startupProbe: {
              exec: etcdExec,
              initialDelaySeconds: 1,
            },
          },
        ],
      },
    },
  },
}

try {
  await appsV1.createNamespacedStatefulSet({
    namespace: config.RESIDE_NAMESPACE,
    fieldManager,
    body: etcdStatefulSetBody,
  })

  logger.info("successfully created StatefulSet for etcd")
} catch (err) {
  if (!isAlreadyExists(err)) {
    throw new Error("Failed to create StatefulSet for etcd", { cause: err })
  }

  logger.info("StatefulSet for etcd already exists")
}

// 1.5. wait for Jazz to be ready
while (true) {
  try {
    logger.info("waiting for jazz StatefulSet to be ready...")
    await new Promise(resolve => setTimeout(resolve, 3000))

    const statefulSetStatus = await appsV1.readNamespacedStatefulSetStatus({
      namespace: config.RESIDE_NAMESPACE,
      name: "jazz",
    })

    if (statefulSetStatus.status?.readyReplicas && statefulSetStatus.status.readyReplicas >= 1) {
      logger.info("jazz StatefulSet is ready")
      break
    }
  } catch (err) {
    throw new Error("Failed to get jazz StatefulSet status", { cause: err })
  }
}

// 1.6. wait for etcd to be ready
while (true) {
  try {
    logger.info("waiting for etcd StatefulSet to be ready...")
    await new Promise(resolve => setTimeout(resolve, 3000))

    const statefulSetStatus = await appsV1.readNamespacedStatefulSetStatus({
      namespace: config.RESIDE_NAMESPACE,
      name: "etcd",
    })

    if (statefulSetStatus.status?.readyReplicas && statefulSetStatus.status.readyReplicas >= 1) {
      logger.info("etcd StatefulSet is ready")
      break
    }
  } catch (err) {
    throw new Error("Failed to get etcd StatefulSet status", { cause: err })
  }
}

// phase 2. prepare initial data for replicas

// 1. create jazz account for alpha
const { account: tempAlphaAccount, credentials: alphaCredentials } = await createWorkerAccount(
  "replica.alpha",
  jazzUrl,
)

// 2. create jazz account for kubernetes-sentinel
const { account: tempK8sAccount, credentials: k8sCredentials } = await createWorkerAccount(
  "replica.kubernetes-sentinel",
  jazzUrl,
)

logger.info("created jazz accounts for alpha and kubernetes-sentinel replicas")

// 3. create RCB for alpha owned by alpha account
const alphaRcb = ReplicaControlBlock.create(
  {
    id: 1,
    name: "alpha",
    requirements: {
      // just to allow alpha to bootstrap properly
      k8s: [tempAlphaAccount.$jazz.id],
    },
    permissions: {},
  },
  Group.create(tempAlphaAccount),
)

// 4. create RCB for kubernetes-sentinel owned by alpha account
const k8sRcb = ReplicaControlBlock.create(
  {
    id: 2,
    name: "kubernetes-sentinel",
    requirements: {},
    permissions: {},
  },
  Group.create(tempAlphaAccount),
)

const k8sAccountOnTempAlphaSide = await co
  .account()
  .load(tempK8sAccount.$jazz.id, { loadAs: tempAlphaAccount })

if (!k8sAccountOnTempAlphaSide.$isLoaded) {
  throw new Error("Failed to load kubernetes-sentinel account on alpha side")
}

// allow kubernetes-sentinel to access its own RCB
k8sRcb.$jazz.owner.addMember(k8sAccountOnTempAlphaSide, "writer")

logger.info("created RCBs for alpha and kubernetes-sentinel replicas")

// phase 3. launch complete kubernetes-sentinel and alpha and let it sync permissions in realtime

process.env.RESIDE_SYNC_SERVER_URL = jazzUrl
process.env.RESIDE_ETCD_HOSTS = etcdUrl
process.env.RESIDE_CONTROL_BLOCK_ID = k8sRcb.$jazz.id
process.env.RESIDE_ACCOUNT_ID = k8sCredentials.accountId
process.env.RESIDE_AGENT_SECRET = k8sCredentials.agentSecret

const {
  account: k8sAccount,
  implementations: { k8s },
  shutdownWorker: shutdownK8sWorker,
} = await startReplica(KubernetesSentinel)

logger.info("launched kubernetes-sentinel replica")

process.env.RESIDE_CONTROL_BLOCK_ID = alphaRcb.$jazz.id
process.env.RESIDE_ACCOUNT_ID = alphaCredentials.accountId
process.env.RESIDE_AGENT_SECRET = alphaCredentials.agentSecret

const {
  account: alphaAccount,
  implementations: { alpha },
  shutdownWorker: shutdownAlphaWorker,
} = await startReplica(AlphaReplica)

logger.info("launched Alpha Replica")

// phase 4. run load sequence for seed, kubernetes-sentinel and Alpha Replicas via alpha

await runLoadSequence("seed")
await runLoadSequence("kubernetes-sentinel", k8sAccount, k8sRcb)
await runLoadSequence("alpha", alphaAccount, alphaRcb)

// phase 5. now switch back to kubernetes-sentinel and setup other global resources

setActiveAccount(k8sAccount)

const loadedK8sData = await k8s.data.$jazz.ensureLoaded({
  resolve: {
    services: { $each: true },
    statefulSets: { $each: true },
    serviceAccounts: { $each: true },
    roles: { $each: true },
    roleBindings: { $each: true },
    deployments: { $each: true },
    networkPolicies: { $each: true },
    ingresses: { $each: true },
    persistentVolumeClaims: { $each: true },
    secrets: { $each: true },
  },
})

// register manually created resources to kubernetes-sentinel management
loadedK8sData.services.$jazz.set("jazz", {
  name: "jazz",
  status: "requested",

  manifest: {
    apiVersion: "v1",
    kind: "Service",

    metadata: jazzServiceBody.metadata!,
    spec: jazzServiceBody.spec!,
  } as IService,
})

loadedK8sData.statefulSets.$jazz.set("jazz", {
  name: "jazz",
  status: "requested",

  manifest: {
    apiVersion: "apps/v1",
    kind: "StatefulSet",

    metadata: jazzStatefulSetBody.metadata!,
    spec: jazzStatefulSetBody.spec!,
  } as IStatefulSet,
})

loadedK8sData.persistentVolumeClaims.$jazz.set("jazz-data", {
  name: "jazz-data",
  status: "requested",

  manifest: {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",

    metadata: jazzVolumeClaimTemplate.metadata!,
    spec: jazzVolumeClaimTemplate.spec!,
  } as IPersistentVolumeClaim,
})

loadedK8sData.services.$jazz.set("etcd", {
  name: "etcd",
  status: "requested",

  manifest: {
    apiVersion: "v1",
    kind: "Service",

    metadata: etcdServiceBody.metadata!,
    spec: etcdServiceBody.spec!,
  } as IService,
})

loadedK8sData.statefulSets.$jazz.set("etcd", {
  name: "etcd",
  status: "requested",

  manifest: {
    apiVersion: "apps/v1",
    kind: "StatefulSet",

    metadata: etcdStatefulSetBody.metadata!,
    spec: etcdStatefulSetBody.spec!,
  } as IStatefulSet,
})

// create service account for kubernetes-sentinel (now we are under seed's temp SA)
loadedK8sData.serviceAccounts.$jazz.set("kubernetes-sentinel", {
  name: "kubernetes-sentinel",
  status: "requested",

  manifest: {
    apiVersion: "v1",
    kind: "ServiceAccount",
  },
})

// create role for kubernetes-sentinel
loadedK8sData.roles.$jazz.set("kubernetes-sentinel", {
  name: "kubernetes-sentinel",
  status: "requested",

  manifest: {
    apiVersion: "rbac.authorization.k8s.io/v1",
    kind: "Role",

    // allow any action within the cluster
    rules: [
      {
        apiGroups: ["*"],
        resources: ["*"],
        verbs: ["*"],
      },
    ],
  },
})

// create role binding for kubernetes-sentinel service account
loadedK8sData.roleBindings.$jazz.set("kubernetes-sentinel-binding", {
  name: "kubernetes-sentinel-binding",
  status: "requested",

  manifest: {
    apiVersion: "rbac.authorization.k8s.io/v1",
    kind: "RoleBinding",

    metadata: {
      name: "kubernetes-sentinel-binding",
    },
    subjects: [
      {
        kind: "ServiceAccount",
        name: "kubernetes-sentinel",
        namespace: config.RESIDE_NAMESPACE,
      },
    ],
    roleRef: {
      kind: "Role",
      name: "kubernetes-sentinel",
      apiGroup: "rbac.authorization.k8s.io",
    },
  },
})

logger.info("registered global resources to kubernetes-sentinel for management")

// now we can finally sync all the above requests to Kubernetes
// all except for network policies, because they will immediately block our access to the cluster
const clusterAlpha = new ClusterAlpha(config.RESIDE_NAMESPACE, logger)

await clusterAlpha.syncManagedObjects(loadedK8sData.serviceAccounts, objectTypes.serviceAccount, {
  // to keep seed temp SA
  keepUnmanaged: true,
})

await clusterAlpha.syncManagedObjects(loadedK8sData.roles, objectTypes.role, {
  // to keep seed temp role
  keepUnmanaged: true,
})

await clusterAlpha.syncManagedObjects(loadedK8sData.roleBindings, objectTypes.roleBinding, {
  // to keep seed temp role binding
  keepUnmanaged: true,
})

await clusterAlpha.syncManagedObjects(loadedK8sData.services, objectTypes.service)
await clusterAlpha.syncManagedObjects(loadedK8sData.statefulSets, objectTypes.statefulSet)
await clusterAlpha.syncManagedObjects(
  loadedK8sData.persistentVolumeClaims,
  objectTypes.persistentVolumeClaim,
)

await clusterAlpha.syncManagedObjects(loadedK8sData.secrets, objectTypes.secret)
await clusterAlpha.syncManagedObjects(loadedK8sData.deployments, objectTypes.deployment)

logger.info("synchronized global resources to Kubernetes cluster")

if (config.RESIDE_DOMAIN && !config.RESIDE_CLUSTER_ISSUER) {
  throw new Error(
    "RESIDE_CLUSTER_ISSUER must be set in order to create ingresses with TLS certificates",
  )
}

// create other global resources that will be synced by kubernetes-sentinel after restart
loadedK8sData.ingresses.$jazz.set("jazz", {
  name: "jazz",
  status: "requested",

  manifest: {
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
          host: config.RESIDE_DOMAIN,
          http: {
            paths: [
              {
                backend: { service: { name: "jazz", port: { number: jazzPort } } },
                pathType: "Prefix",
                path: "/",
              },
            ],
          },
        },
      ],
      tls: config.RESIDE_DOMAIN
        ? [{ hosts: [config.RESIDE_DOMAIN], secretName: "tls" }]
        : undefined,
    },
  },
})

logger.info("created ingress to be synced after restart")

await shutdownK8sWorker()
await shutdownAlphaWorker()

logger.info("shut down kubernetes-sentinel and alpha replicas")

logger.info("alpha account id: %s", alphaAccount.$jazz.id)
logger.info("seed replica setup completed successfully, i will die soon, bye :(")
process.exit(0)

async function runLoadSequence(
  replica: string,
  account?: Account,
  rcb?: ReplicaControlBlock,
): Promise<void> {
  logger.info("running load sequence for %s replica via alpha", replica)

  const loadRequest = await createLoadRequest(
    alpha.data,
    {
      image: `ghcr.io/exeteres/reside/replicas/${replica}`,
    },
    alphaAccount,
  )

  await validateLoadRequest(alpha.data, loadRequest, logger)

  logger.info("load request for %s validated", replica)

  if (!loadRequest.approveRequest) {
    throw new Error("Load request has no approve request")
  }

  // bypass any external approval process
  loadRequest.$jazz.set("status", "approved")

  // create replica version from load request
  await createReplicaVersionFromLoadRequest(
    alpha.data,
    // yes, we pass "k8s" object managed by sentinel session,
    // while in standard usage we pass "k8s" managed by alpha session
    // this works because both "k8s" objects point to the same covalue
    k8s.data,
    loadRequest,
    logger,

    account
      ? // reuse existing account
        () => Promise.resolve(account)
      : undefined,

    rcb
      ? // reuse existing RCB, but also create index for it
        async (alpha, replica) => {
          // reload RCB under alpha account
          const loadedRcb = await ReplicaControlBlock.load(rcb.$jazz.id, { loadAs: alphaAccount })
          if (!loadedRcb.$isLoaded) {
            throw new Error(`Failed to load RCB with ID ${rcb.$jazz.id}`)
          }

          // allow users with rcb:manage:all permission to read/write the RCB
          const loadedData = await alpha.$jazz.ensureLoaded({ resolve: { rcbManageGroup: true } })
          loadedRcb.$jazz.owner.addMember(loadedData.rcbManageGroup, "writer")

          await createReplicaControlBlockIndex(alpha, replica, loadedRcb)

          return loadedRcb
        }
      : undefined,
  )

  logger.info("created replica version for %s replica", replica)
}
