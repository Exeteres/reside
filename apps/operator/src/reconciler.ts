import type {
  BatchV1Api,
  CoreV1Api,
  CustomObjectsApi,
  RbacAuthorizationV1Api,
  V1Job,
  V1JobCondition,
  V1Pod,
} from "@kubernetes/client-node"
import { operatorConfig } from "./config"
import { logger } from "./logger"
import { parseReplica, parseReplicaListResponse, type Replica } from "./replica"
import { isNotFoundError } from "./utils"

function getJobCondition(job: V1Job, type: "Complete" | "Failed"): V1JobCondition | undefined {
  return job.status?.conditions?.find(condition => {
    return condition.type === type && condition.status === "True"
  })
}

function getJobFailureMessage(job: V1Job): string {
  const failedCondition = getJobCondition(job, "Failed")
  if (!failedCondition) {
    return "Bootstrap job failed"
  }

  if (failedCondition.message && failedCondition.message.length > 0) {
    return failedCondition.message
  }

  if (failedCondition.reason && failedCondition.reason.length > 0) {
    return `Bootstrap job failed: ${failedCondition.reason}`
  }

  return "Bootstrap job failed"
}

function getPodImagePullFailureMessage(pod: V1Pod): string | undefined {
  const containerStatuses = pod.status?.containerStatuses
  if (!containerStatuses) {
    return undefined
  }

  for (const containerStatus of containerStatuses) {
    const waitingState = containerStatus.state?.waiting
    if (!waitingState) {
      continue
    }

    const reason = waitingState.reason
    if (reason !== "ErrImagePull" && reason !== "ImagePullBackOff") {
      continue
    }

    const containerName = containerStatus.name
    const message = waitingState.message
    if (message && message.length > 0) {
      return `Bootstrap job image pull failed for container "${containerName}": ${message}`
    }

    return `Bootstrap job image pull failed for container "${containerName}": ${reason}`
  }

  return undefined
}

async function getBootstrapPodFailureMessage(
  coreApi: CoreV1Api,
  namespace: string,
  jobName: string,
): Promise<string | undefined> {
  const podList = await coreApi.listNamespacedPod({
    namespace,
    labelSelector: `job-name=${jobName}`,
  })

  for (const pod of podList.items ?? []) {
    const failureMessage = getPodImagePullFailureMessage(pod)
    if (failureMessage) {
      return failureMessage
    }
  }

  return undefined
}

type BootstrapJobStatus =
  | {
      state: "created"
    }
  | {
      state: "recreated"
    }
  | {
      state: "running"
    }
  | {
      state: "failed"
      message: string
    }
  | {
      state: "succeeded"
    }

function getReplicaNamespace(replicaName: string): string {
  return `replica-${replicaName}`
}

function getReplicaNameFromNamespace(namespace: string): string | undefined {
  if (!namespace.startsWith("replica-")) {
    return undefined
  }

  const replicaName = namespace.slice("replica-".length)
  if (replicaName.length === 0) {
    return undefined
  }

  return replicaName
}

async function ensureNamespace(coreApi: CoreV1Api, namespace: string): Promise<void> {
  try {
    await coreApi.readNamespace({ name: namespace })
    return
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error
    }
  }

  await coreApi.createNamespace({
    body: {
      metadata: {
        name: namespace,
      },
    },
  })

  logger.info({ namespace }, 'created namespace "%s"', namespace)
}

async function ensureServiceAccount(
  coreApi: CoreV1Api,
  namespace: string,
  serviceAccountName: string,
): Promise<void> {
  try {
    await coreApi.readNamespacedServiceAccount({ name: serviceAccountName, namespace })
    return
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error
    }
  }

  await coreApi.createNamespacedServiceAccount({
    namespace,
    body: {
      metadata: {
        name: serviceAccountName,
        namespace,
      },
    },
  })

  logger.info(
    { namespace, serviceAccountName },
    'created serviceaccount "%s" in namespace "%s"',
    serviceAccountName,
    namespace,
  )
}

async function ensureAdminRoleBinding(
  rbacApi: RbacAuthorizationV1Api,
  namespace: string,
  roleBindingName: string,
  roleName: string,
  serviceAccountName: string,
): Promise<void> {
  try {
    await rbacApi.readNamespacedRoleBinding({ name: roleBindingName, namespace })
    return
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error
    }
  }

  await rbacApi.createNamespacedRoleBinding({
    namespace,
    body: {
      metadata: {
        name: roleBindingName,
        namespace,
      },
      roleRef: {
        apiGroup: "rbac.authorization.k8s.io",
        kind: "Role",
        name: roleName,
      },
      subjects: [
        {
          kind: "ServiceAccount",
          name: serviceAccountName,
          namespace,
        },
      ],
    },
  })

  logger.info(
    { namespace, roleBindingName },
    'created rolebinding "%s" in namespace "%s"',
    roleBindingName,
    namespace,
  )
}

async function ensureAdminRole(
  rbacApi: RbacAuthorizationV1Api,
  namespace: string,
  roleName: string,
): Promise<void> {
  try {
    await rbacApi.readNamespacedRole({ name: roleName, namespace })
    return
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error
    }
  }

  await rbacApi.createNamespacedRole({
    namespace,
    body: {
      metadata: {
        name: roleName,
        namespace,
      },
      rules: [
        {
          apiGroups: ["*"],
          resources: ["*"],
          verbs: ["*"],
        },
      ],
    },
  })

  logger.info({ namespace, roleName }, 'created role "%s" in namespace "%s"', roleName, namespace)
}

async function createBootstrapJob(
  batchApi: BatchV1Api,
  namespace: string,
  replicaName: string,
  jobName: string,
  serviceAccountName: string,
  image: string,
): Promise<void> {
  await batchApi.createNamespacedJob({
    namespace,
    body: {
      metadata: {
        name: jobName,
        namespace,
        labels: {
          "app.kubernetes.io/name": `replica-${replicaName}`,
          "reside.io/replica": replicaName,
          "reside.io/component": "bootstrap",
        },
      },
      spec: {
        backoffLimit: 0,
        template: {
          metadata: {
            labels: {
              "app.kubernetes.io/name": `replica-${replicaName}`,
              "reside.io/replica": replicaName,
              "reside.io/component": "bootstrap",
            },
          },
          spec: {
            restartPolicy: "Never",
            serviceAccountName,
            containers: [
              {
                name: "bootstrap",
                image,
                imagePullPolicy: "Always",
                env: [
                  {
                    name: "NODE_EXTRA_CA_CERTS",
                    value: "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt",
                  },
                  {
                    name: "REPLICA_NAME",
                    value: replicaName,
                  },
                  {
                    name: "REPLICA_COMPONENT_NAME",
                    value: jobName,
                  },
                  {
                    name: "REPLICA_NAMESPACE",
                    value: namespace,
                  },
                  {
                    name: "REPLICA_SERVICE_ACCOUNT_NAME",
                    value: serviceAccountName,
                  },
                  {
                    name: "REPLICA_IMAGE",
                    value: image,
                  },
                  {
                    name: "RESIDE_CLUSTER_DOMAIN",
                    value: operatorConfig.clusterDomain,
                  },
                  {
                    name: "RESIDE_BIN",
                    value: "bootstrap",
                  },
                ],
              },
            ],
          },
        },
      },
    },
  })

  logger.info(
    { namespace, jobName, image },
    'created job "%s" in namespace "%s" with image "%s"',
    jobName,
    namespace,
    image,
  )
}

async function waitForJobDeletion(
  batchApi: BatchV1Api,
  namespace: string,
  jobName: string,
): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await batchApi.readNamespacedJob({ name: jobName, namespace })
    } catch (error) {
      if (isNotFoundError(error)) {
        return
      }

      throw error
    }

    await Bun.sleep(1_000)
  }

  throw new Error(
    `Timeout while waiting for deletion of job "${jobName}" in namespace "${namespace}"`,
  )
}

async function ensureBootstrapJob(
  coreApi: CoreV1Api,
  batchApi: BatchV1Api,
  namespace: string,
  replicaName: string,
  jobName: string,
  serviceAccountName: string,
  image: string,
): Promise<BootstrapJobStatus> {
  let existingJob: V1Job | undefined

  try {
    existingJob = await batchApi.readNamespacedJob({ name: jobName, namespace })
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error
    }
  }

  if (!existingJob) {
    await createBootstrapJob(batchApi, namespace, replicaName, jobName, serviceAccountName, image)
    return {
      state: "created",
    }
  }

  const currentImage = existingJob.spec?.template?.spec?.containers?.[0]?.image
  if (currentImage !== image) {
    logger.info(
      { namespace, jobName, currentImage, nextImage: image },
      'replacing job "%s" in namespace "%s" for image update',
      jobName,
      namespace,
    )
    await batchApi.deleteNamespacedJob({
      name: jobName,
      namespace,
      propagationPolicy: "Foreground",
    })

    await waitForJobDeletion(batchApi, namespace, jobName)
    await createBootstrapJob(batchApi, namespace, replicaName, jobName, serviceAccountName, image)

    return {
      state: "recreated",
    }
  }

  if (getJobCondition(existingJob, "Failed")) {
    return {
      state: "failed",
      message: getJobFailureMessage(existingJob),
    }
  }

  if (getJobCondition(existingJob, "Complete")) {
    return {
      state: "succeeded",
    }
  }

  const podFailureMessage = await getBootstrapPodFailureMessage(coreApi, namespace, jobName)
  if (podFailureMessage) {
    return {
      state: "failed",
      message: podFailureMessage,
    }
  }

  return {
    state: "running",
  }
}

export type ReconcileReplicaResult = {
  phase: "Ready" | "Reconciling" | "Failed"
  conditionStatus: "True" | "False"
  reason: string
  message: string
}

export async function reconcileReplica(
  coreApi: CoreV1Api,
  rbacApi: RbacAuthorizationV1Api,
  batchApi: BatchV1Api,
  replica: Replica,
): Promise<ReconcileReplicaResult> {
  const replicaNamespace = getReplicaNamespace(replica.name)
  const serviceAccountName = replica.name
  const roleName = `${replica.name}-admin`
  const roleBindingName = `${replica.name}-admin`
  const jobName = `${replica.name}-bootstrap`

  await ensureNamespace(coreApi, replicaNamespace)
  await ensureServiceAccount(coreApi, replicaNamespace, serviceAccountName)
  await ensureAdminRole(rbacApi, replicaNamespace, roleName)
  await ensureAdminRoleBinding(
    rbacApi,
    replicaNamespace,
    roleBindingName,
    roleName,
    serviceAccountName,
  )
  const bootstrapJobStatus = await ensureBootstrapJob(
    coreApi,
    batchApi,
    replicaNamespace,
    replica.name,
    jobName,
    serviceAccountName,
    replica.image,
  )

  switch (bootstrapJobStatus.state) {
    case "created": {
      return {
        phase: "Reconciling",
        conditionStatus: "False",
        reason: "BootstrapJobCreated",
        message: `Created bootstrap job for image "${replica.image}" and waiting for it to complete`,
      }
    }
    case "recreated": {
      return {
        phase: "Reconciling",
        conditionStatus: "False",
        reason: "BootstrapJobRecreated",
        message: `Recreated bootstrap job for updated image "${replica.image}" and waiting for it to complete`,
      }
    }
    case "running": {
      return {
        phase: "Reconciling",
        conditionStatus: "False",
        reason: "BootstrapJobRunning",
        message: `Waiting for bootstrap job to complete for image "${replica.image}"`,
      }
    }
    case "failed": {
      return {
        phase: "Failed",
        conditionStatus: "False",
        reason: "BootstrapJobFailed",
        message: bootstrapJobStatus.message,
      }
    }
    case "succeeded": {
      return {
        phase: "Ready",
        conditionStatus: "True",
        reason: "Reconciled",
        message: "Replica resources are reconciled",
      }
    }
  }
}

export async function patchReplicaStatus(
  customObjectsApi: CustomObjectsApi,
  replica: Replica,
  status: ReconcileReplicaResult,
): Promise<void> {
  const replicaStatus = {
    phase: status.phase,
    observedGeneration: replica.generation,
    conditions: [
      {
        type: "Ready",
        status: status.conditionStatus,
        reason: status.reason,
        message: status.message,
        lastTransitionTime: new Date().toISOString(),
      },
    ],
  }

  await customObjectsApi.patchClusterCustomObjectStatus({
    group: operatorConfig.replicaApiGroup,
    version: operatorConfig.replicaApiVersion,
    plural: operatorConfig.replicaPlural,
    name: replica.name,
    body: [{ op: "add", path: "/status", value: replicaStatus }],
  })
}

export async function listReplicas(customObjectsApi: CustomObjectsApi): Promise<Replica[]> {
  const listResponse: unknown = await customObjectsApi.listClusterCustomObject({
    group: operatorConfig.replicaApiGroup,
    version: operatorConfig.replicaApiVersion,
    plural: operatorConfig.replicaPlural,
  })

  const items = parseReplicaListResponse(listResponse)
  const replicas: Replica[] = []

  for (const item of items) {
    const replica = parseReplica(item)
    if (!replica) {
      logger.warn({ item }, "skipping invalid replica object")
      continue
    }

    replicas.push(replica)
  }

  return replicas
}

export async function cleanupOrphanReplicaNamespaces(
  coreApi: CoreV1Api,
  replicas: Replica[],
): Promise<void> {
  const expectedReplicaNames = new Set(replicas.map(replica => replica.name))
  const namespaceList = await coreApi.listNamespace({})

  for (const namespaceResource of namespaceList.items ?? []) {
    const namespaceName = namespaceResource.metadata?.name
    if (!namespaceName) {
      continue
    }

    const replicaName = getReplicaNameFromNamespace(namespaceName)
    if (!replicaName) {
      continue
    }

    if (expectedReplicaNames.has(replicaName)) {
      continue
    }

    try {
      await coreApi.deleteNamespace({ name: namespaceName })
      logger.info(
        { namespace: namespaceName },
        'deleted orphan replica namespace "%s"',
        namespaceName,
      )
    } catch (error) {
      if (isNotFoundError(error)) {
        continue
      }

      throw error
    }
  }
}
