import { type RunnerHandle, run } from "@grammyjs/runner"
import { CoreV1Api, KubeConfig } from "@kubernetes/client-node"
import { startService } from "@reside/api"
import { ApprovalServiceDefinition } from "@reside/api/common/approval.v1"
import {
  OperationServiceDefinition,
  OperationSubscriptionServiceDefinition,
} from "@reside/api/common/operation.v1"
import { SubjectServiceDefinition } from "@reside/api/common/subject.v1"
import { DefinitionServiceDefinition } from "@reside/api/interaction/definition.v1"
import { NotificationServiceDefinition } from "@reside/api/interaction/notification.v1"
import {
  createOperationSubscriptionService,
  getReplicaNamespace,
  logger,
  runTemporalWorker,
} from "@reside/common"
import { createServer } from "nice-grpc"
import { createServices } from "../shared"
import { createTelegramActivities } from "./activities"
import { createTelegramBot } from "./bot"
import { loadTelegramConfigState } from "./config"
import { loadTelegramSecretState } from "./secret"
import { createApprovalService } from "./services/approval"
import { createDefinitionService } from "./services/definition"
import { createNotificationService } from "./services/notification"
import { createSubjectService } from "./services/subject"

const SECRET_POLL_INTERVAL_MS = 5_000

const {
  prisma,
  operationService,
  databaseProvisionService,
  databaseOperationService,
  interactionNotificationService,
  interactionOperationService,
  accessAuthzService,
  accessRequestService,
  accessSubjectService,
  temporalClient,
} = await createServices()

const server = createServer()

server.add(DefinitionServiceDefinition, createDefinitionService(prisma, accessAuthzService))
server.add(
  NotificationServiceDefinition,
  createNotificationService(prisma, operationService, accessAuthzService, accessSubjectService),
)
server.add(
  ApprovalServiceDefinition,
  createApprovalService(prisma, operationService, temporalClient),
)
server.add(SubjectServiceDefinition, createSubjectService(prisma))
server.add(OperationServiceDefinition, operationService.implementation)
server.add(
  OperationSubscriptionServiceDefinition,
  createOperationSubscriptionService(temporalClient),
)

await startService(server)

const stopSignal = createStopSignal()

const namespace = getReplicaNamespace()
const kubeConfig = new KubeConfig()
kubeConfig.loadFromDefault()
const coreApi = kubeConfig.makeApiClient(CoreV1Api)

await operationService.startOperationWorker({
  provisionService: databaseProvisionService,
  operationService: databaseOperationService,
})

if (stopSignal.stopped) {
  logger.info({ namespace }, "stop requested before telegram runtime startup")
} else {
  await runTemporalWorker({
    provisionService: databaseProvisionService,
    operationService: databaseOperationService,
    activities: createTelegramActivities({
      prisma,
      notificationService: interactionNotificationService,
      operationService: interactionOperationService,
      localOperationService: operationService,
    }),
  })

  if (stopSignal.stopped) {
    logger.info({ namespace }, "stop requested during telegram runtime startup")
  } else {
    logger.info({ namespace }, "starting telegram replica")

    const botRuntime = createBotRuntime({
      prisma,
      operationService,
      accessAuthzService,
      accessRequestService,
    })
    let currentResourceVersion: string | undefined
    let currentConfigResourceVersion: string | undefined

    while (!stopSignal.stopped) {
      try {
        const [secretState, configState] = await Promise.all([
          loadTelegramSecretState(coreApi, namespace),
          loadTelegramConfigState(coreApi, namespace),
        ])

        if (stopSignal.stopped) {
          break
        }

        if (
          secretState.resourceVersion !== currentResourceVersion ||
          configState.resourceVersion !== currentConfigResourceVersion
        ) {
          currentResourceVersion = secretState.resourceVersion
          currentConfigResourceVersion = configState.resourceVersion

          if (stopSignal.stopped) {
            break
          }

          await botRuntime.reconcile(
            secretState.botToken,
            configState.systemChatId,
            configState.superAdminUserId,
          )
        }
      } catch (error) {
        if (stopSignal.stopped && isPoolClosedError(error)) {
          break
        }

        logger.error(
          {
            error: error instanceof Error ? error.message : String(error),
          },
          "failed to reconcile telegram bot secret",
        )
      }

      if (stopSignal.stopped) {
        break
      }

      await Bun.sleep(SECRET_POLL_INTERVAL_MS)
    }

    await botRuntime.dispose()
  }
}

function createBotRuntime(args: {
  prisma: Awaited<ReturnType<typeof createServices>>["prisma"]
  operationService: Awaited<ReturnType<typeof createServices>>["operationService"]
  accessAuthzService: Awaited<ReturnType<typeof createServices>>["accessAuthzService"]
  accessRequestService: Awaited<ReturnType<typeof createServices>>["accessRequestService"]
}): {
  reconcile: (
    nextToken: string | undefined,
    nextSystemChatId: string | undefined,
    nextSuperAdminUserId: string | undefined,
  ) => Promise<void>
  dispose: () => Promise<void>
} {
  let currentToken: string | undefined
  let currentSystemChatId: string | undefined
  let currentSuperAdminUserId: string | undefined
  let currentRunner: RunnerHandle | undefined

  return {
    reconcile: async (
      nextToken: string | undefined,
      nextSystemChatId: string | undefined,
      nextSuperAdminUserId: string | undefined,
    ) => {
      if (
        nextToken === currentToken &&
        nextSystemChatId === currentSystemChatId &&
        nextSuperAdminUserId === currentSuperAdminUserId
      ) {
        return
      }

      if (currentRunner) {
        logger.info("stopping telegram bot instance")
        await currentRunner.stop()
        currentRunner = undefined
      }

      currentToken = nextToken
      currentSystemChatId = nextSystemChatId
      currentSuperAdminUserId = nextSuperAdminUserId

      if (!nextToken || nextToken.length === 0) {
        logger.info("telegram bot token is not configured, bot stays stopped")
        return
      }

      const bot = await createTelegramBot({
        token: nextToken,
        prisma: args.prisma,
        operationService: args.operationService,
        authzService: args.accessAuthzService,
        permissionRequestService: args.accessRequestService,
        superAdminUserId: nextSuperAdminUserId,
      })
      currentRunner = run(bot)

      logger.info({ username: bot.botInfo.username }, "telegram bot instance started")
    },
    dispose: async () => {
      if (!currentRunner) {
        return
      }

      await currentRunner.stop()
      currentRunner = undefined
    },
  }
}

function createStopSignal(): { stopped: boolean } {
  const signal = {
    stopped: false,
  }

  const stop = () => {
    signal.stopped = true
  }

  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)

  return signal
}

function isPoolClosedError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  return error.message.includes("Cannot use a pool after calling end on the pool")
}
