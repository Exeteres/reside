import type { ApprovalRequest, ApprovalServiceImplementation } from "@reside/api/common/approval.v1"
import type { Operation, OperationServiceImplementation } from "@reside/api/common/operation.v1"
import type { SubjectServiceImplementation } from "@reside/api/common/subject.v1"
import { create, toJson } from "@bufbuild/protobuf"
import { EmptySchema } from "@bufbuild/protobuf/wkt"
import { Code, ConnectError } from "@connectrpc/connect"
import { fastifyConnectPlugin } from "@connectrpc/connect-fastify"
import { CoreV1Api } from "@kubernetes/client-node"
import {
  ApprovalResponseSchema,
  ApprovalResult,
  ApprovalService,
} from "@reside/api/common/approval.v1"
import {
  GetOperationResponseSchema,
  OperationSchema,
  OperationService,
  OperationStatus,
  SubscribeToOperationCompletionResponseSchema,
} from "@reside/api/common/operation.v1"
import { SubjectDisplayInfoSchema, SubjectService } from "@reside/api/common/subject.v1"
import {
  createServer,
  getReplicaComponentName,
  getReplicaNamespace,
  kubeConfig,
  startServer,
  toProtoDateTime,
} from "@reside/common"
import { strings } from "../locale"

const E2E_APPROVER_OPERATION_TITLE = "E2E Auto Approval"

export type E2EApprovalServer = {
  endpoint: string
  shutdown: () => Promise<void>
}

export async function startE2EApprovalServer(): Promise<E2EApprovalServer> {
  const operations = new Map<number, Operation>()
  let nextOperationId = 1

  const approvalService: ApprovalServiceImplementation = {
    async approve(request: ApprovalRequest) {
      const operationId = nextOperationId
      nextOperationId += 1

      const now = new Date()
      const approvalResponse = create(ApprovalResponseSchema, {
        result: ApprovalResult.APPROVED,
        resolution: strings.e2e.autoApprovalResolution,
      })

      const operation = create(OperationSchema, {
        id: operationId,
        title: request.title.length > 0 ? request.title : E2E_APPROVER_OPERATION_TITLE,
        description: strings.e2e.autoApprovalDescription,
        status: OperationStatus.COMPLETED,
        resolution: {
          case: "result",
          value: toJson(ApprovalResponseSchema, approvalResponse),
        },
        resolvedAt: now.toISOString(),
        createdAt: toProtoDateTime(now),
        updatedAt: toProtoDateTime(now),
      })

      operations.set(operationId, operation)

      return operation
    },
  }

  const operationService: OperationServiceImplementation = {
    async getOperation(request) {
      const operation = operations.get(request.operationId)
      if (!operation) {
        throw new ConnectError(`Operation "${request.operationId}" was not found`, Code.NotFound)
      }

      return create(GetOperationResponseSchema, {
        operation,
      })
    },

    async subscribeToOperationCompletion(request) {
      const operation = operations.get(request.operationId)
      if (!operation) {
        throw new ConnectError(`Operation "${request.operationId}" was not found`, Code.NotFound)
      }

      return create(SubscribeToOperationCompletionResponseSchema, {
        response: {
          case: "completedOperation",
          value: operation,
        },
      })
    },

    async cancelOperation() {
      return create(EmptySchema)
    },
  }

  const subjectService: SubjectServiceImplementation = {
    async getSubjectDisplayInfo(request) {
      const parsedSubjectId = parseSubjectId(request.subjectId)
      if (parsedSubjectId === null) {
        throw new ConnectError(
          'Subject ID must match format "{realm}:{name}"',
          Code.InvalidArgument,
        )
      }

      return create(SubjectDisplayInfoSchema, {
        title: `E2E ${parsedSubjectId.subjectName}`,
        avatarUrl: undefined,
      })
    },
  }

  const server = await createServer({})

  await server.register(fastifyConnectPlugin, {
    routes(router) {
      router.service(ApprovalService, approvalService)
      router.service(OperationService, operationService)
      router.service(SubjectService, subjectService)
    },
  })

  await startServer(server)

  return {
    endpoint: await getCurrentPodEndpoint(),
    shutdown: async (): Promise<void> => {
      await server.close()
    },
  }
}

function parseSubjectId(subjectId: string): { realmName: string; subjectName: string } | null {
  const segments = subjectId.trim().split(":")
  if (segments.length !== 2) {
    return null
  }

  const realmName = segments[0]
  const subjectName = segments[1]
  if (!realmName || !subjectName) {
    return null
  }

  return {
    realmName,
    subjectName,
  }
}

async function getCurrentPodEndpoint(): Promise<string> {
  const coreApi = kubeConfig.makeApiClient(CoreV1Api)
  const namespace = getReplicaNamespace()
  const componentName = getReplicaComponentName()

  for (let attempt = 0; attempt < 40; attempt++) {
    const podListResponse = await coreApi.listNamespacedPod({
      namespace,
      labelSelector: `job-name=${componentName}`,
    })

    const podItems = podListResponse.items ?? []
    const preferredPod =
      podItems.find(
        pod =>
          pod.status?.phase === "Running" && pod.status.podIP && !pod.metadata?.deletionTimestamp,
      ) ?? podItems.find(pod => pod.status?.podIP)

    const podIp = preferredPod?.status?.podIP
    if (podIp) {
      return `${podIp}:8080`
    }

    await new Promise(resolve => setTimeout(resolve, 250))
  }

  throw new Error(
    `Failed to resolve e2e approval pod IP for component "${componentName}" in namespace "${namespace}"`,
  )
}
