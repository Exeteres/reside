import type { PrismaClient } from "../../database"
import { CustomObjectsApi } from "@kubernetes/client-node"
import { kubeConfig, logger, registerGracefulShutdown } from "@reside/common"
import {
  isNotFoundError,
  REPLICA_API_GROUP,
  REPLICA_API_VERSION,
  REPLICA_PLURAL,
  readReplicaCrd,
} from "../../shared/replica-crd"

const RECONCILE_INTERVAL_MS = 5_000
const REPLICA_NAMESPACE_PREFIX = "replica-"

const KYVERNO_POLICY_API_GROUP = "policies.kyverno.io"
const KYVERNO_MUTATING_POLICY_API_VERSION = "v1"
const KYVERNO_MUTATING_POLICY_PLURAL = "mutatingpolicies"
const KYVERNO_DELETING_POLICY_API_VERSION = "v1"
const KYVERNO_DELETING_POLICY_PLURAL = "deletingpolicies"

type ReplicaVersion = {
  major: number
  minor: number
  patch: number
  prerelease: string[]
}

const REPLICA_VERSION_PATTERN =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

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
      await reconcileReplicaCrdImage(customObjectsApi, {
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

export async function reconcileReplicaCrdImage(
  customObjectsApi: CustomObjectsApi,
  args: {
    name: string
    image: string
  },
): Promise<void> {
  const replicaCrd = await readReplicaCrd(customObjectsApi, args.name)

  if (
    replicaCrd.exists &&
    !shouldUpdateReplicaCrdImage({
      databaseImage: args.image,
      clusterImage: replicaCrd.image,
    })
  ) {
    return
  }

  await upsertReplicaCrd(customObjectsApi, args)
}

export function shouldUpdateReplicaCrdImage(args: {
  databaseImage: string
  clusterImage: string | null
}): boolean {
  if (args.clusterImage === null) {
    return true
  }

  const databaseVersion = parseReplicaVersion(extractContainerImageTag(args.databaseImage))
  const clusterVersion = parseReplicaVersion(extractContainerImageTag(args.clusterImage))

  if (databaseVersion === null || clusterVersion === null) {
    return false
  }

  return compareReplicaVersions(databaseVersion, clusterVersion) > 0
}

export function extractContainerImageTag(image: string): string | null {
  const digestStartIndex = image.indexOf("@")
  const imageWithoutDigest = digestStartIndex === -1 ? image : image.slice(0, digestStartIndex)

  const lastSlashIndex = imageWithoutDigest.lastIndexOf("/")
  const lastColonIndex = imageWithoutDigest.lastIndexOf(":")
  if (lastColonIndex === -1 || lastColonIndex < lastSlashIndex) {
    return null
  }

  const tag = imageWithoutDigest.slice(lastColonIndex + 1).trim()
  return tag.length > 0 ? tag : null
}

function parseReplicaVersion(version: string | null): ReplicaVersion | null {
  if (version === null) {
    return null
  }

  const match = REPLICA_VERSION_PATTERN.exec(version)
  if (match === null) {
    return null
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split(".") ?? [],
  }
}

function compareReplicaVersions(left: ReplicaVersion, right: ReplicaVersion): number {
  const majorDifference = left.major - right.major
  if (majorDifference !== 0) {
    return majorDifference
  }

  const minorDifference = left.minor - right.minor
  if (minorDifference !== 0) {
    return minorDifference
  }

  const patchDifference = left.patch - right.patch
  if (patchDifference !== 0) {
    return patchDifference
  }

  return comparePrereleaseVersions(left.prerelease, right.prerelease)
}

function comparePrereleaseVersions(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) {
    return 0
  }

  if (left.length === 0) {
    return 1
  }

  if (right.length === 0) {
    return -1
  }

  const maxLength = Math.max(left.length, right.length)
  for (let index = 0; index < maxLength; index += 1) {
    const leftIdentifier = left[index]
    const rightIdentifier = right[index]

    if (leftIdentifier === undefined) {
      return -1
    }

    if (rightIdentifier === undefined) {
      return 1
    }

    const identifierComparison = comparePrereleaseIdentifiers(leftIdentifier, rightIdentifier)
    if (identifierComparison !== 0) {
      return identifierComparison
    }
  }

  return 0
}

function comparePrereleaseIdentifiers(left: string, right: string): number {
  const leftNumber = parsePrereleaseNumber(left)
  const rightNumber = parsePrereleaseNumber(right)

  if (leftNumber !== null && rightNumber !== null) {
    return leftNumber - rightNumber
  }

  if (leftNumber !== null) {
    return -1
  }

  if (rightNumber !== null) {
    return 1
  }

  return left.localeCompare(right)
}

function parsePrereleaseNumber(identifier: string): number | null {
  if (!/^(?:0|[1-9]\d*)$/.test(identifier)) {
    return null
  }

  return Number(identifier)
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
