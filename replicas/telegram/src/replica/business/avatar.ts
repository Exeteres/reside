import type { Client } from "@temporalio/client"
import type { PrismaClient } from "../../database"
import { DEFAULT_TEMPORAL_TASK_QUEUE, logger } from "@reside/common"
import { WorkflowIdReusePolicy } from "@temporalio/client"
import {
  getAvatarProvisionWorkflowId,
  TELEGRAM_AVATAR_PROVISION_WORKFLOW_TYPE,
} from "../../definitions"
import { strings } from "../../locale"

type AvatarVersionTagBotFactory = (
  token: string,
  args: { role?: string },
) => {
  api: {
    setChatAdministratorCustomTitle(
      chatId: string,
      userId: number,
      customTitle: string,
    ): Promise<unknown>
  }
}

export async function ensureAvatarProvision(
  prisma: PrismaClient,
  temporalClient: Client,
  subjectId: string,
  replicaName: string,
  replicaTitle: string,
): Promise<{ operationId: number | undefined }> {
  logger.info('ensuring avatar provision subject_id="%s" replica_name="%s"', subjectId, replicaName)

  const existingAvatar = await prisma.avatar.findUnique({
    where: {
      subjectId,
    },
    select: {
      id: true,
    },
  })

  if (existingAvatar !== null) {
    logger.info('avatar already exists subject_id="%s" replica_name="%s"', subjectId, replicaName)

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
    logger.info(
      'reusing pending avatar provision operation_id="%s" subject_id="%s" replica_name="%s"',
      String(pendingProvisionOperationId),
      subjectId,
      replicaName,
    )

    return {
      operationId: pendingProvisionOperationId,
    }
  }

  const expectedPrefix = `reside_${replicaName}`
  logger.info(
    'creating avatar provision operation subject_id="%s" replica_name="%s" expected_prefix="%s"',
    subjectId,
    replicaName,
    expectedPrefix,
  )

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

  logger.info(
    'started avatar provision workflow operation_id="%s" workflow_id="%s" replica_name="%s"',
    String(created.id),
    getAvatarProvisionWorkflowId(created.id),
    replicaName,
  )

  return {
    operationId: created.id,
  }
}

export async function updateAvatarVersionTag(
  prisma: PrismaClient,
  createTelegramBotClient: AvatarVersionTagBotFactory,
  args: {
    managerBotToken: string
    systemChatId: string
    replicaName: string
    newVersion: string
  },
): Promise<void> {
  logger.info(
    'updating avatar version tag replica_name="%s" new_version="%s" system_chat_id="%s"',
    args.replicaName,
    args.newVersion,
    args.systemChatId,
  )

  const managerBot = createTelegramBotClient(args.managerBotToken, {
    role: "avatar.version-tag",
  })

  const avatar = await prisma.avatar.findUnique({
    where: {
      replicaName: args.replicaName,
    },
    select: {
      managedBotId: true,
    },
  })

  if (avatar === null) {
    logger.info(
      'skipping avatar version tag update because avatar was not found replica_name="%s"',
      args.replicaName,
    )

    return
  }

  const managedBotIdRaw = Number(avatar.managedBotId)

  const managedBotId = Number(managedBotIdRaw)

  if (!Number.isInteger(managedBotId)) {
    logger.warn(
      'avatar has invalid managed bot id for version tag update replica_name="%s" managed_bot_id="%s"',
      args.replicaName,
      String(managedBotIdRaw),
    )
    throw new Error(`Avatar for replica "${args.replicaName}" has invalid managed bot id`)
  }

  await managerBot.api.setChatAdministratorCustomTitle(
    args.systemChatId,
    managedBotId,
    `v${args.newVersion}`,
  )

  logger.info(
    'updated avatar version tag replica_name="%s" managed_bot_id="%s" version_tag="%s"',
    args.replicaName,
    String(managedBotId),
    `v${args.newVersion}`,
  )
}
