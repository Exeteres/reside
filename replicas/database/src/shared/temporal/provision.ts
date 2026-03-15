import type { WorkflowService } from "@temporalio/client"
import { status as grpcStatus } from "@grpc/grpc-js"
import { isGrpcServiceError } from "@temporalio/client"
import { msToTs } from "@temporalio/common/lib/time"

/**
 * Ensures a Temporal namespace exists.
 *
 * @param workflowService The raw Temporal workflow service.
 * @param namespace The namespace to ensure.
 * @returns The ensured namespace.
 */
export async function ensureTemporalNamespace(
  workflowService: WorkflowService,
  namespace: string,
): Promise<string> {
  const existingNamespace = await describeNamespace(workflowService, namespace)
  if (existingNamespace !== null) {
    return namespace
  }

  await workflowService.registerNamespace({
    namespace,
    workflowExecutionRetentionPeriod: msToTs("72h"),
  })

  return namespace
}

async function describeNamespace(
  workflowService: WorkflowService,
  namespace: string,
): Promise<string | null> {
  try {
    const response = await workflowService.describeNamespace({
      namespace,
    })

    return response.namespaceInfo?.name ?? namespace
  } catch (error) {
    if (isGrpcServiceError(error) && error.code === grpcStatus.NOT_FOUND) {
      return null
    }

    throw error
  }
}
