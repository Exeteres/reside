import type { FastifyReply, FastifyRequest } from "fastify"
import { fastifyConnectPlugin } from "@connectrpc/connect-fastify"
import { CoreV1Api } from "@kubernetes/client-node"
import { ApprovalService } from "@reside/api/common/approval.v1"
import { OperationService, OperationSubscriptionService } from "@reside/api/common/operation.v1"
import { PingService } from "@reside/api/common/ping.v1"
import { SubjectService } from "@reside/api/common/subject.v1"
import { AvatarService } from "@reside/api/interaction/avatar.v1"
import { DefinitionService } from "@reside/api/interaction/definition.v1"
import { NotificationService } from "@reside/api/interaction/notification.v1"
import { TopicService } from "@reside/api/interaction/topic.v1"
import {
  createInteractionActivities,
  createOperationSubscriptionService,
  createPingService,
  createServer,
  crypto,
  defineGateway,
  getReplicaNamespace,
  kubeConfig,
  logger,
  registerGracefulShutdown,
  setupEncryption,
  setupLanguageSubsystem,
  startTemporalWorker,
} from "@reside/common"
import { TELEGRAM_GATEWAY_NAME, TELEGRAM_WEBHOOK_PATH } from "../definitions"
import { strings } from "../locale"
import { createServices } from "../shared"
import { createTelegramActivities } from "./activities"
import { createBotRuntime, createWebhookUrl } from "./business/bot-runtime"
import { loadTelegramConfigState } from "./business/config"
import { loadTelegramSecretState } from "./business/secret"
import { createApprovalService } from "./services/approval"
import { createAvatarService } from "./services/avatar"
import { createDefinitionService } from "./services/definition"
import { createNotificationService } from "./services/notification"
import { createSubjectService } from "./services/subject"
import { createTopicService } from "./services/topic"

const SECRET_POLL_INTERVAL_MS = 5_000

const services = await createServices()
const server = await createServer(services)

await setupEncryption({ services, server })

await server.register(fastifyConnectPlugin, {
  routes(router) {
    router.service(DefinitionService, createDefinitionService(services))
    router.service(NotificationService, createNotificationService({ ...services, crypto }))
    router.service(TopicService, createTopicService({ ...services, crypto }))
    router.service(ApprovalService, createApprovalService(services))
    router.service(AvatarService, createAvatarService({ ...services, crypto }))
    router.service(SubjectService, createSubjectService({ ...services, crypto }))
    router.service(PingService, createPingService())
    router.service(OperationService, services.operationService.implementation)
    router.service(
      OperationSubscriptionService,
      createOperationSubscriptionService(services.temporalClient),
    )
  },
})

await setupLanguageSubsystem({
  services,
  server,
  title: strings.bootstrap.registration.title,
  description: strings.bootstrap.registration.description,
  mission: "Mediate user interactions through Telegram commands and notifications.",
})

const { endpoint: telegramGatewayEndpoint } = await defineGateway({
  services,
  name: TELEGRAM_GATEWAY_NAME,
  title: strings.bootstrap.gateway.title,
  description: strings.bootstrap.gateway.description,
})

const webhookUrl = createWebhookUrl(telegramGatewayEndpoint)
const botRuntime = createBotRuntime({ services: { ...services, crypto }, webhookUrl })

server.post(TELEGRAM_WEBHOOK_PATH, async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    await botRuntime.handleWebhookUpdate(
      request.headers["x-telegram-bot-api-secret-token"],
      request.body,
    )
  } catch (error) {
    const errorObject = error instanceof Error ? error : new Error(String(error))

    logger.error(
      {
        error: errorObject,
      },
      "failed to handle telegram webhook update",
    )
  }

  return await reply.code(200).send({ ok: true })
})

await server.listen({ host: "0.0.0.0", port: 8080 })

registerGracefulShutdown(async () => {
  logger.info("shutting down bot runtime")
  await botRuntime.dispose()
})

const stopSignal = createStopSignal()

const namespace = getReplicaNamespace()
const coreApi = kubeConfig.makeApiClient(CoreV1Api)

if (stopSignal.stopped) {
  logger.info({ namespace }, "stop requested before telegram runtime startup")
} else {
  await startTemporalWorker({
    services,
    activities: {
      ...services.operationService.activities,
      ...createInteractionActivities(
        services.notificationService,
        services.interactionOperationService,
        services.topicService,
      ),
      ...createTelegramActivities({
        prisma: services.prisma,
        operationService: services.operationService,
        discoveryService: services.discoveryService,
        authzService: services.authzService,
        permissionRequestService: services.permissionRequestService,
        gatewayService: services.gatewayService,
        infraOperationService: services.infraOperationService,
        crypto,
      }),
    },
  })

  if (stopSignal.stopped) {
    logger.info({ namespace }, "stop requested during telegram runtime startup")
  } else {
    logger.info({ namespace }, "starting telegram replica")

    while (!stopSignal.stopped) {
      try {
        const [secretState, configState] = await Promise.all([
          loadTelegramSecretState(crypto),
          loadTelegramConfigState(coreApi, namespace),
        ])

        if (stopSignal.stopped) {
          break
        }

        await botRuntime.reconcile(
          secretState.botToken,
          configState.systemChatId,
          configState.superAdminUserId,
        )
      } catch (error) {
        if (stopSignal.stopped && isPoolClosedError(error)) {
          break
        }

        const errorObject = error instanceof Error ? error : new Error(String(error))

        logger.error(
          {
            error: errorObject,
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
