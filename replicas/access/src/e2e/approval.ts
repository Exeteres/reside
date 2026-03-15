import type { ApprovalRequest, ApprovalServiceImplementation } from "@reside/api/common/approval.v1"
import type {
  GetOperationRequest,
  GetOperationResponse,
  Operation,
  OperationServiceImplementation,
  SubscribeToOperationCompletionRequest,
  SubscribeToOperationCompletionResponse,
} from "@reside/api/common/operation.v1"
import type {
  GetSubjectDisplayInfoRequest,
  SubjectDisplayInfo,
  SubjectServiceImplementation,
} from "@reside/api/common/subject.v1"
import { status } from "@grpc/grpc-js"
import { CoreV1Api } from "@kubernetes/client-node"
import { startService } from "@reside/api"
import { ApprovalResult, ApprovalServiceDefinition } from "@reside/api/common/approval.v1"
import { OperationServiceDefinition, OperationStatus } from "@reside/api/common/operation.v1"
import { SubjectServiceDefinition } from "@reside/api/common/subject.v1"
import {
  getReplicaComponentName,
  getReplicaNamespace,
  kubeConfig,
  toProtoDateTime,
} from "@reside/common"
import { type CallContext, createServer, ServerError } from "nice-grpc"
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
    async approve(request: ApprovalRequest): Promise<Operation> {
      const operationId = nextOperationId
      nextOperationId += 1

      const now = new Date()
      const operation = {
        id: operationId,
        title: request.title.length > 0 ? request.title : E2E_APPROVER_OPERATION_TITLE,
        description: strings.e2e.autoApprovalDescription,
        status: OperationStatus.COMPLETED,
        resolution: {
          $case: "result" as const,
          value: {
            result: ApprovalResult.APPROVED,
            resolution: strings.e2e.autoApprovalResolution,
          },
        },
        resolvedAt: now.toISOString(),
        createdAt: toProtoDateTime(now),
        updatedAt: toProtoDateTime(now),
      }

      operations.set(operationId, operation)

      return operation
    },
  }

  const operationService: OperationServiceImplementation = {
    async getOperation(request: GetOperationRequest): Promise<GetOperationResponse> {
      const operation = operations.get(request.operationId)
      if (!operation) {
        throw new ServerError(status.NOT_FOUND, `Operation "${request.operationId}" was not found`)
      }

      return {
        operation,
      }
    },

    async subscribeToOperationCompletion(
      request: SubscribeToOperationCompletionRequest,
      _context: CallContext,
    ): Promise<SubscribeToOperationCompletionResponse> {
      const operation = operations.get(request.operationId)
      if (!operation) {
        throw new ServerError(status.NOT_FOUND, `Operation "${request.operationId}" was not found`)
      }

      return {
        response: {
          $case: "completedOperation",
          value: operation,
        },
      }
    },

    async cancelOperation() {
      return {}
    },
  }

  const subjectService: SubjectServiceImplementation = {
    async getSubjectDisplayInfo(
      request: GetSubjectDisplayInfoRequest,
    ): Promise<SubjectDisplayInfo> {
      const parsedSubjectId = parseSubjectId(request.subjectId)
      if (parsedSubjectId === null) {
        throw new ServerError(
          status.INVALID_ARGUMENT,
          'Subject ID must match format "{realm}:{name}"',
        )
      }

      return {
        title: `E2E ${parsedSubjectId.subjectName}`,
        avatarUrl: undefined,
      }
    },
  }

  const server = createServer()
  server.add(ApprovalServiceDefinition, approvalService)
  server.add(OperationServiceDefinition, operationService)
  server.add(SubjectServiceDefinition, subjectService)

  await startService(server)

  return {
    endpoint: await getCurrentPodEndpoint(),
    shutdown: async (): Promise<void> => {
      await server.shutdown()
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
