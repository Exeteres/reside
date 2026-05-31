import type { PrismaClient } from "../../database"
import { CustomObjectsApi } from "@kubernetes/client-node"
import { kubeConfig, logger, registerGracefulShutdown } from "@reside/common"
import {
  isNotFoundError,
  REPLICA_API_GROUP,
  REPLICA_API_VERSION,
  REPLICA_PLURAL,
} from "../../shared/replica-crd"

const RECONCILE_INTERVAL_MS = 5_000
const REPLICA_NAMESPACE_PREFIX = "replica-"

const KYVERNO_POLICY_API_GROUP = "policies.kyverno.io"
const KYVERNO_MUTATING_POLICY_API_VERSION = "v1"
const KYVERNO_MUTATING_POLICY_PLURAL = "mutatingpolicies"
const KYVERNO_DELETING_POLICY_API_VERSION = "v1"
const KYVERNO_DELETING_POLICY_PLURAL = "deletingpolicies"

export function setupReplicaCrdReconciliation(prisma: PrismaClient): void {
  const customObjectsApi = kubeConfig.makeApiClient(CustomObjectsApi)
  let stopped = false

  let loopPromise: Promise<void> | undefined

  const runLoop = async (): Promise<void> => {
    while (!stopped) {
      try {
        await reconcileReplicaCrds(prisma, customObjectsApi)
      } catch (error) {
        if (stopped) {
          break
        }

        logger.error({ error }, "failed to reconcile replica CRDs")
      }

      if (stopped) {
        break
      }

      await Bun.sleep(RECONCILE_INTERVAL_MS)
    }
  }

  loopPromise = runLoop()

  registerGracefulShutdown(async () => {
    stopped = true

    if (loopPromise) {
      await loopPromise
    }
  })

  void loopPromise
}

async function reconcileReplicaCrds(
  prisma: PrismaClient,
  customObjectsApi: CustomObjectsApi,
): Promise<void> {
  const replicas = await prisma.replica.findMany({
    select: {
      name: true,
      image: true,
      node: true,
    },
  })

  for (const replica of replicas) {
    const image = replica.image
    const node = replica.node?.trim() ?? null

    if (image !== null) {
      await upsertReplicaCrd(customObjectsApi, {
        name: replica.name,
        image,
      })
    }

    await reconcileReplicaNodePolicies(customObjectsApi, {
      replicaName: replica.name,
      nodeName: node && node.length > 0 ? node : null,
    })
  }
}

async function reconcileReplicaNodePolicies(
  customObjectsApi: CustomObjectsApi,
  args: {
    replicaName: string
    nodeName: string | null
  },
): Promise<void> {
  const mutatingPolicyName = buildReplicaNodeMutatingPolicyName(args.replicaName)
  const deletingPolicyName = buildReplicaNodeDeletingPolicyName(args.replicaName)
  const namespace = `${REPLICA_NAMESPACE_PREFIX}${args.replicaName}`

  if (args.nodeName === null) {
    await deleteMutatingPolicy(customObjectsApi, mutatingPolicyName)
    await deleteDeletingPolicy(customObjectsApi, deletingPolicyName)
    return
  }

  await upsertMutatingPolicy(customObjectsApi, {
    name: mutatingPolicyName,
    spec: buildReplicaNodeMutatingPolicySpec(namespace, args.nodeName),
  })

  await upsertDeletingPolicy(customObjectsApi, {
    name: deletingPolicyName,
    spec: buildReplicaNodeDeletingPolicySpec(namespace, args.nodeName),
  })
}

async function upsertMutatingPolicy(
  customObjectsApi: CustomObjectsApi,
  args: {
    name: string
    spec: Record<string, unknown>
  },
): Promise<void> {
  await upsertClusterCustomObject(customObjectsApi, {
    group: KYVERNO_POLICY_API_GROUP,
    version: KYVERNO_MUTATING_POLICY_API_VERSION,
    plural: KYVERNO_MUTATING_POLICY_PLURAL,
    kind: "MutatingPolicy",
    name: args.name,
    spec: args.spec,
  })
}

async function upsertDeletingPolicy(
  customObjectsApi: CustomObjectsApi,
  args: {
    name: string
    spec: Record<string, unknown>
  },
): Promise<void> {
  await upsertClusterCustomObject(customObjectsApi, {
    group: KYVERNO_POLICY_API_GROUP,
    version: KYVERNO_DELETING_POLICY_API_VERSION,
    plural: KYVERNO_DELETING_POLICY_PLURAL,
    kind: "DeletingPolicy",
    name: args.name,
    spec: args.spec,
  })
}

async function upsertClusterCustomObject(
  customObjectsApi: CustomObjectsApi,
  args: {
    group: string
    version: string
    plural: string
    kind: string
    name: string
    spec: Record<string, unknown>
  },
): Promise<void> {
  try {
    await customObjectsApi.patchClusterCustomObject({
      group: args.group,
      version: args.version,
      plural: args.plural,
      name: args.name,
      body: [{ op: "add", path: "/spec", value: args.spec }],
    })

    return
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error
    }
  }

  await customObjectsApi.createClusterCustomObject({
    group: args.group,
    version: args.version,
    plural: args.plural,
    body: {
      apiVersion: `${args.group}/${args.version}`,
      kind: args.kind,
      metadata: {
        name: args.name,
      },
      spec: args.spec,
    },
  })
}

async function deleteMutatingPolicy(
  customObjectsApi: CustomObjectsApi,
  policyName: string,
): Promise<void> {
  await deleteCustomObject(customObjectsApi, {
    group: KYVERNO_POLICY_API_GROUP,
    version: KYVERNO_MUTATING_POLICY_API_VERSION,
    plural: KYVERNO_MUTATING_POLICY_PLURAL,
    name: policyName,
  })
}

async function deleteDeletingPolicy(
  customObjectsApi: CustomObjectsApi,
  policyName: string,
): Promise<void> {
  await deleteCustomObject(customObjectsApi, {
    group: KYVERNO_POLICY_API_GROUP,
    version: KYVERNO_DELETING_POLICY_API_VERSION,
    plural: KYVERNO_DELETING_POLICY_PLURAL,
    name: policyName,
  })
}

async function deleteCustomObject(
  customObjectsApi: CustomObjectsApi,
  args: {
    group: string
    version: string
    plural: string
    name: string
  },
): Promise<void> {
  try {
    await customObjectsApi.deleteClusterCustomObject({
      group: args.group,
      version: args.version,
      plural: args.plural,
      name: args.name,
    })
  } catch (error) {
    if (isNotFoundError(error)) {
      return
    }

    throw error
  }
}

function buildReplicaNodeMutatingPolicyName(replicaName: string): string {
  return `alpha-replica-node-mutating-${replicaName}`
}

function buildReplicaNodeDeletingPolicyName(replicaName: string): string {
  return `alpha-replica-node-deleting-${replicaName}`
}

function buildReplicaNodeMutatingPolicySpec(
  namespace: string,
  nodeName: string,
): Record<string, unknown> {
  const escapedNodeName = JSON.stringify(nodeName)
  const requiredTolerationExpression =
    'has(object.spec.tolerations) && object.spec.tolerations.exists(t, t.key == "node.reside.io/special" && (!has(t.operator) || t.operator == "Exists") && (!has(t.effect) || t.effect == "NoExecute"))'

  return {
    matchConstraints: {
      namespaceSelector: {
        matchLabels: {
          "kubernetes.io/metadata.name": namespace,
        },
      },
      resourceRules: [
        {
          apiGroups: [""],
          apiVersions: ["v1"],
          operations: ["CREATE"],
          resources: ["pods"],
          scope: "Namespaced",
        },
      ],
    },
    matchConditions: [
      {
        name: "pin-pods-with-missing-or-mismatched-node-selector-or-toleration",
        expression: `!has(object.spec.nodeSelector) || !("kubernetes.io/hostname" in object.spec.nodeSelector) || object.spec.nodeSelector["kubernetes.io/hostname"] != ${escapedNodeName} || !(${requiredTolerationExpression})`,
      },
    ],
    mutations: [
      {
        patchType: "JSONPatch",
        jsonPatch: {
          expression: `[JSONPatch{op: "replace", path: "/spec/nodeSelector", value: {"kubernetes.io/hostname": ${escapedNodeName}}}, JSONPatch{op: "replace", path: "/spec/tolerations", value: (has(object.spec.tolerations) && ${requiredTolerationExpression} ? object.spec.tolerations : (has(object.spec.tolerations) ? object.spec.tolerations + [Object.spec.tolerations{key: "node.reside.io/special", operator: "Exists", effect: "NoExecute"}] : [Object.spec.tolerations{key: "node.reside.io/special", operator: "Exists", effect: "NoExecute"}]))}]`,
        },
      },
    ],
    reinvocationPolicy: "Never",
  }
}

function buildReplicaNodeDeletingPolicySpec(
  namespace: string,
  nodeName: string,
): Record<string, unknown> {
  const requestedNodeName = JSON.stringify(nodeName)

  return {
    schedule: "*/1 * * * *",
    matchConstraints: {
      namespaceSelector: {
        matchLabels: {
          "kubernetes.io/metadata.name": namespace,
        },
      },
      resourceRules: [
        {
          apiGroups: [""],
          apiVersions: ["v1"],
          operations: ["*"],
          resources: ["pods"],
          scope: "Namespaced",
        },
      ],
    },
    conditions: [
      {
        name: "delete-pods-with-missing-or-mismatched-node-selector",
        expression: `!has(object.spec.nodeSelector) || !("kubernetes.io/hostname" in object.spec.nodeSelector) || object.spec.nodeSelector["kubernetes.io/hostname"] != ${requestedNodeName}`,
      },
    ],
  }
}

async function upsertReplicaCrd(
  customObjectsApi: CustomObjectsApi,
  args: {
    name: string
    image: string
  },
): Promise<void> {
  const spec = {
    image: args.image,
  }

  try {
    await customObjectsApi.patchClusterCustomObject({
      group: REPLICA_API_GROUP,
      version: REPLICA_API_VERSION,
      plural: REPLICA_PLURAL,
      name: args.name,
      body: [{ op: "add", path: "/spec", value: spec }],
    })

    return
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error
    }
  }

  await customObjectsApi.createClusterCustomObject({
    group: REPLICA_API_GROUP,
    version: REPLICA_API_VERSION,
    plural: REPLICA_PLURAL,
    body: {
      apiVersion: `${REPLICA_API_GROUP}/${REPLICA_API_VERSION}`,
      kind: "Replica",
      metadata: {
        name: args.name,
      },
      spec,
    },
  })
}
