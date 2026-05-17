import type { Operation, PrismaClient } from "../database"
import { createHash } from "node:crypto"
import { CoreV1Api } from "@kubernetes/client-node"
import { type GenericOperationService, getReplicaNamespace, kubeConfig } from "@reside/common"
import { strings } from "../locale"
import { createTelegramBotClient } from "./bot-client"
import { createWebhookUrl } from "./bot-runtime"
import { loadTelegramSecretState, TELEGRAM_SECRET_NAME } from "./secret"

type ApprovalActionName = "approve" | "reject" | "escalate"

export function createTelegramActivities(args: {
  prisma: PrismaClient
  operationService: GenericOperationService<Operation>
}) {
  const namespace = getReplicaNamespace()
  const coreApi = kubeConfig.makeApiClient(CoreV1Api)

  return {
    async getAvatarProvisionRequest(operationId: number): Promise<{
      operationId: number
      subjectId: string
      replicaName: string
      replicaTitle: string
      expectedPrefix: string
    }> {
      const request = await args.prisma.avatarProvisionRequest.findUnique({
        where: {
          operationId,
        },
        select: {
          operationId: true,
          subjectId: true,
          replicaName: true,
          replicaTitle: true,
          expectedPrefix: true,
        },
      })

      if (!request) {
        throw new Error(`Avatar provisioning request for operation "${operationId}" was not found`)
      }

      return request
    },

    async getAvatarProvisioningPromptLink(input: { operationId: number }): Promise<string> {
      const request = await args.prisma.avatarProvisionRequest.findUnique({
        where: {
          operationId: input.operationId,
        },
      })

      if (!request) {
        throw new Error(
          `Avatar provisioning request for operation "${input.operationId}" was not found`,
        )
      }

      const secretState = await loadTelegramSecretState(coreApi, namespace)
      if (!secretState.botToken) {
        throw new Error(`Secret "${TELEGRAM_SECRET_NAME}" must contain "bot_token"`)
      }

      const managerBot = createTelegramBotClient(secretState.botToken, {
        role: "activity.manager",
      })
      const me = await managerBot.api.getMe()
      const managerBotUsername = me.username?.trim()
      if (!managerBotUsername) {
        throw new Error("Manager bot username is not available")
      }

      const requestLink = createManagedBotLink(
        managerBotUsername,
        request.expectedPrefix,
        request.replicaTitle,
      )

      return requestLink
    },

    async completeAvatarProvisionOperation(input: {
      operationId: number
      managedBotId: string
      managedBotUsername: string
    }): Promise<void> {
      const request = await args.prisma.avatarProvisionRequest.findUnique({
        where: {
          operationId: input.operationId,
        },
      })

      if (!request) {
        throw new Error(
          `Avatar provisioning request for operation "${input.operationId}" was not found`,
        )
      }

      const secretState = await loadTelegramSecretState(coreApi, namespace)
      if (!secretState.botToken) {
        throw new Error(`Secret "${TELEGRAM_SECRET_NAME}" must contain "bot_token"`)
      }

      const managerBot = createTelegramBotClient(secretState.botToken, {
        role: "activity.manager",
      })
      const managedBotId = parseManagedBotId(input.managedBotId)
      const replacement = await managerBot.api.replaceManagedBotToken(managedBotId)

      const avatarBot = createTelegramBotClient(replacement, {
        role: "activity.avatar",
      })

      await avatarBot.api.setWebhook(createWebhookUrl(), {
        secret_token: createWebhookSecret(replacement),
        drop_pending_updates: false,
        allowed_updates: ["callback_query"],
      })

      await args.prisma.$transaction(async tx => {
        const avatar = await tx.avatar.upsert({
          where: {
            subjectId: request.subjectId,
          },
          create: {
            subjectId: request.subjectId,
            replicaName: request.replicaName,
            replicaTitle: request.replicaTitle,
            managedBotId: input.managedBotId,
            managedBotUsername: input.managedBotUsername,
            createdByUserId: request.createdByUserId,
            token: replacement,
          },
          update: {
            replicaTitle: request.replicaTitle,
            managedBotId: input.managedBotId,
            managedBotUsername: input.managedBotUsername,
            createdByUserId: request.createdByUserId,
            token: replacement,
          },
          select: {
            id: true,
          },
        })

        await tx.avatarProvisionRequest.update({
          where: {
            operationId: input.operationId,
          },
          data: {
            avatarId: avatar.id,
          },
        })
      })

      await args.operationService.setCompleted(input.operationId)
    },

    async failAvatarProvisionOperation(input: {
      operationId: number
      reason: string
      message: string
    }): Promise<void> {
      await args.prisma.operation.update({
        where: {
          id: input.operationId,
        },
        data: {
          status: "FAILED",
          failureReason: input.reason,
          failureMessage: input.message,
          resolvedAt: new Date(),
        },
      })
    },

    async completeApprovalOperation(input: {
      operationId: number
      actionName: ApprovalActionName
    }): Promise<void> {
      const mappedResult = mapActionToResult(input.actionName)

      await args.prisma.$transaction(async tx => {
        await tx.approvalRequest.update({
          where: {
            operationId: input.operationId,
          },
          data: {
            result: mappedResult.result,
            resolution: mappedResult.resolution,
            respondedAt: new Date(),
          },
        })
      })

      await args.operationService.setCompleted(input.operationId)
    },

    async failApprovalOperation(input: {
      operationId: number
      reason: string
      message: string
    }): Promise<void> {
      await args.prisma.operation.update({
        where: {
          id: input.operationId,
        },
        data: {
          status: "FAILED",
          failureReason: input.reason,
          failureMessage: input.message,
          resolvedAt: new Date(),
        },
      })
    },
  }
}

function parseManagedBotId(value: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) {
    throw new Error(`Invalid managed bot id "${value}"`)
  }

  return parsed
}

function createManagedBotLink(
  managerBotUsername: string,
  expectedPrefix: string,
  suggestedBotName: string,
): string {
  const suggestedBotUsername = `${expectedPrefix}_bot`
  return `https://t.me/newbot/${managerBotUsername}/${suggestedBotUsername}?name=${encodeURIComponent(suggestedBotName)}`
}

function mapActionToResult(actionName: ApprovalActionName): {
  result: "ESCALATED" | "APPROVED" | "REJECTED"
  resolution: string
} {
  switch (actionName) {
    case "approve":
      return {
        result: "APPROVED",
        resolution: strings.worker.activities.approvalResolutionApproved,
      }
    case "reject":
      return {
        result: "REJECTED",
        resolution: strings.worker.activities.approvalResolutionRejected,
      }
    case "escalate":
      return {
        result: "ESCALATED",
        resolution: strings.worker.activities.approvalResolutionEscalated,
      }
  }
}

function createWebhookSecret(token: string): string {
  return createHash("sha256").update(`telegram-webhook:${token}`).digest("hex")
}
