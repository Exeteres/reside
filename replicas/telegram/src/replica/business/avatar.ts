import type { Client } from "@temporalio/client"
import type { PrismaClient } from "../../database"
import { DEFAULT_TEMPORAL_TASK_QUEUE } from "@reside/common"
import { WorkflowIdReusePolicy } from "@temporalio/client"
import {
  getAvatarProvisionWorkflowId,
  TELEGRAM_AVATAR_PROVISION_WORKFLOW_TYPE,
} from "../../definitions"
import { strings } from "../../locale"

export async function ensureAvatarProvision(
  prisma: PrismaClient,
  temporalClient: Client,
  subjectId: string,
  replicaName: string,
  replicaTitle: string,
): Promise<{ operationId: number | undefined }> {
  const existingAvatar = await prisma.avatar.findUnique({
    where: {
      subjectId,
    },
    select: {
      id: true,
    },
  })

  if (existingAvatar !== null) {
    return {
      operationId: undefined,
    }
  }

  const pendingProvision = await prisma.avatarProvisionRequest.findFirst({
    where: {
      subjectId,
      operation: {
        status: "PENDING",
      },
    },
    orderBy: {
      id: "desc",
    },
    select: {
      operationId: true,
    },
  })
  const pendingProvisionOperationId = pendingProvision?.operationId
  if (pendingProvisionOperationId !== undefined) {
    return {
      operationId: pendingProvisionOperationId,
    }
  }

  const expectedPrefix = `reside_${replicaName}`
  const created = await prisma.$transaction(async tx => {
    const operation = await tx.operation.create({
      data: {
        title: strings.server.notification.avatarProvisionOperationTitle,
        description: strings.server.notification.avatarProvisionOperationDescription,
      },
      select: {
        id: true,
      },
    })

    await tx.avatarProvisionRequest.create({
      data: {
        operationId: operation.id,
        subjectId,
        replicaName,
        replicaTitle,
        expectedPrefix,
      },
    })

    return operation
  })

  await temporalClient.workflow.start(TELEGRAM_AVATAR_PROVISION_WORKFLOW_TYPE, {
    args: [
      {
        operationId: created.id,
      },
    ],
    workflowId: getAvatarProvisionWorkflowId(created.id),
    taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
    workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY,
  })

  return {
    operationId: created.id,
  }
}
