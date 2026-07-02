import type { GenericOperationService, ResideCrypto } from "@reside/common"
import type { Client as TemporalClient } from "@temporalio/client"
import type { Operation, PrismaClient } from "../../database"
import { ReaperActionHint } from "@reside/api/reaper/handler.v1"
import {
  completeReaperAction,
  createReaperHandler,
  DEFAULT_TEMPORAL_TASK_QUEUE,
  operationReaperAction,
} from "@reside/common"
import { WorkflowExecutionAlreadyStartedError, WorkflowIdReusePolicy } from "@temporalio/client"
import { z } from "zod"
import { OperationType } from "../../database"
import { TELEGRAM_DELETE_AVATAR_WORKFLOW_TYPE } from "../../definitions"
import { strings } from "../../locale"

const deleteCommandsPayloadSchema = z.object({
  commandIds: z.array(z.number().int().positive()).min(1),
})

const deleteChannelsPayloadSchema = z.object({
  channelIds: z.array(z.number().int().positive()).min(1),
})

const deleteAvatarPayloadSchema = z.object({
  avatarId: z.number().int().positive().nullable(),
  replicaName: z.string(),
  avatarProvisionRequestIds: z.array(z.number().int().positive()),
})

const deleteNlsInteractionsPayloadSchema = z.object({
  interactionIds: z.array(z.number().int().positive()).min(1),
})

export function createReaperService({
  prisma,
  temporalClient,
  operationService,
  crypto,
}: {
  prisma: PrismaClient
  temporalClient: TemporalClient
  operationService: GenericOperationService<Operation>
  crypto: ResideCrypto
}) {
  return createReaperHandler({
    crypto,
    actions: {
      deleteCommands: {
        schema: deleteCommandsPayloadSchema,
        async execute(_id, payload) {
          await prisma.command.deleteMany({
            where: {
              id: {
                in: payload.commandIds,
              },
            },
          })
          return completeReaperAction()
        },
      },
      deleteChannels: {
        schema: deleteChannelsPayloadSchema,
        async execute(_id, payload) {
          const channels = await prisma.notificationChannel.findMany({
            where: {
              id: {
                in: payload.channelIds,
              },
            },
            select: {
              topics: {
                select: {
                  threadEcid: true,
                },
              },
              notifications: {
                select: {
                  messageEcid: true,
                  taskPlanningPolls: {
                    select: {
                      messageEcid: true,
                    },
                  },
                },
              },
            },
          })

          const ecids = channels.flatMap(channel => [
            ...channel.topics.map(topic => topic.threadEcid),
            ...channel.notifications.flatMap(notification => [
              notification.messageEcid,
              ...notification.taskPlanningPolls.map(poll => poll.messageEcid),
            ]),
          ])

          await prisma.$transaction(async tx => {
            await tx.notificationChannel.deleteMany({
              where: {
                id: {
                  in: payload.channelIds,
                },
              },
            })

            if (ecids.length > 0) {
              await tx.encryptedContent.deleteMany({
                where: {
                  ecid: {
                    in: ecids,
                  },
                },
              })
            }
          })
          return completeReaperAction()
        },
      },
      deleteAvatar: {
        schema: deleteAvatarPayloadSchema,
        async execute(id, payload) {
          return operationReaperAction(
            await ensureReaperOperation({
              prisma,
              temporalClient,
              operationService,
              actionId: id,
              title: strings.reaper.actions.deleteAvatar(payload.replicaName),
              payload,
            }),
          )
        },
      },
      deleteNlsInteractions: {
        schema: deleteNlsInteractionsPayloadSchema,
        async execute(_id, payload) {
          await prisma.naturalLanguageInteraction.deleteMany({
            where: {
              id: {
                in: payload.interactionIds,
              },
            },
          })
          return completeReaperAction()
        },
      },
    },
    async preview(replicaName) {
      const [commands, channels, avatar, avatarProvisionRequests, nlsInteractions] =
        await Promise.all([
          prisma.command.findMany({
            where: {
              ownerReplicaName: replicaName,
            },
            orderBy: [{ id: "asc" }],
          }),
          prisma.notificationChannel.findMany({
            where: {
              ownerReplicaName: replicaName,
            },
            orderBy: [{ id: "asc" }],
          }),
          prisma.avatar.findUnique({
            where: {
              replicaName,
            },
            select: {
              id: true,
              replicaName: true,
              managedBotUsername: true,
            },
          }),
          prisma.avatarProvisionRequest.findMany({
            where: {
              replicaName,
            },
            select: {
              id: true,
            },
            orderBy: [{ id: "asc" }],
          }),
          prisma.naturalLanguageInteraction.findMany({
            where: {
              replicaName,
            },
            select: {
              id: true,
            },
            orderBy: [{ id: "asc" }],
          }),
        ])

      return [
        ...(commands.length > 0
          ? [
              {
                name: "deleteCommands" as const,
                title: strings.reaper.actions.deleteCommands(commands.length),
                hints: [ReaperActionHint.CRITICAL],
                payload: {
                  commandIds: commands.map(command => command.id),
                },
              },
            ]
          : []),
        ...(channels.length > 0
          ? [
              {
                name: "deleteChannels" as const,
                title: strings.reaper.actions.deleteChannels(channels.length),
                hints: [ReaperActionHint.CRITICAL],
                payload: {
                  channelIds: channels.map(channel => channel.id),
                },
              },
            ]
          : []),
        ...(avatar !== null || avatarProvisionRequests.length > 0
          ? [
              {
                name: "deleteAvatar" as const,
                title: strings.reaper.actions.deleteAvatar(
                  avatar?.managedBotUsername ?? replicaName,
                ),
                hints: [ReaperActionHint.CRITICAL],
                payload: {
                  avatarId: avatar?.id ?? null,
                  replicaName,
                  avatarProvisionRequestIds: avatarProvisionRequests.map(request => request.id),
                },
              },
            ]
          : []),
        ...(nlsInteractions.length > 0
          ? [
              {
                name: "deleteNlsInteractions" as const,
                title: strings.reaper.actions.deleteNlsInteractions(nlsInteractions.length),
                hints: [ReaperActionHint.CRITICAL],
                payload: {
                  interactionIds: nlsInteractions.map(interaction => interaction.id),
                },
              },
            ]
          : []),
      ]
    },
  })
}

async function ensureReaperOperation({
  prisma,
  temporalClient,
  operationService,
  actionId,
  title,
  payload,
}: {
  prisma: PrismaClient
  temporalClient: TemporalClient
  operationService: GenericOperationService<Operation>
  actionId: string
  title: string
  payload: z.infer<typeof deleteAvatarPayloadSchema>
}) {
  const existing = await prisma.operation.findFirst({
    where: {
      reaperActionId: actionId,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  })
  if (existing) {
    return await operationService.toApiOperation(existing.id)
  }

  const operation = await prisma.operation.create({
    data: {
      title,
      type: OperationType.DELETE_AVATAR,
      status: "PENDING",
      reaperActionId: actionId,
    },
  })

  try {
    await temporalClient.workflow.start(TELEGRAM_DELETE_AVATAR_WORKFLOW_TYPE, {
      workflowId: actionId,
      taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
      workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY,
      args: [
        {
          operationId: operation.id,
          avatarId: payload.avatarId,
          replicaName: payload.replicaName,
          avatarProvisionRequestIds: payload.avatarProvisionRequestIds,
        },
      ],
    })
  } catch (error) {
    if (!(error instanceof WorkflowExecutionAlreadyStartedError)) {
      await operationService.setFailed(
        operation.id,
        "REAPER_WORKFLOW_START_FAILED",
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  return await operationService.toApiOperation(operation.id)
}
