import { fastifyConnectPlugin } from "@connectrpc/connect-fastify"
import { OperationService, OperationSubscriptionService } from "@reside/api/common/operation.v1"
import { PingService } from "@reside/api/common/ping.v1"
import { CommandHandlerService } from "@reside/api/interaction/command.v1"
import { ReplicaReaperHandler } from "@reside/api/reaper/handler.v1"
import {
  createCommandHandlerService,
  createInteractionActivities,
  createLanguageEngine,
  createOperationSubscriptionService,
  createPingService,
  createServer,
  crypto,
  logger,
  registerGracefulShutdown,
  setupEncryption,
  setupLanguageSubsystem,
  startServer,
  startTemporalWorker,
} from "@reside/common"
import { strings } from "../locale"
import { createServices } from "../shared"
import { createTaskActivities } from "./activities"
import { startEngineerAiRuntime } from "./business"
import { createCreateTaskTool } from "./nls"
import { createReaperService } from "./services/reaper"

const services = await createServices()
const runtime = await startEngineerAiRuntime()
registerGracefulShutdown(async () => {
  await runtime.stop()
})

const server = await createServer(services)

await setupEncryption({ services, server })

await server.register(fastifyConnectPlugin, {
  routes(router) {
    router.service(CommandHandlerService, createCommandHandlerService(services.temporalClient))
    router.service(ReplicaReaperHandler, createReaperService({ ...services, crypto }))
    router.service(OperationService, services.operationService.implementation)
    router.service(PingService, createPingService())
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
  instructions:
    "Help users turn engineering requests into tracked tasks. " +
    'When the user asks you to plan a task, never plan it yourself in chat; call create_task with mode="plan" and put the full request in the task field. ' +
    'When the user explicitly asks you to implement directly, call create_task with mode="implement". ' +
    "After create_task succeeds, reply with the returned messageLink as the place where the task continues. " +
    "Do not claim that planning or implementation finished merely because the task workflow was started. " +
    'If create_task returns status="failed" or any error field, state that task creation failed, include the returned error, and do not say that anything was planned, created, started, or scheduled.',
  tools: [
    createCreateTaskTool({
      temporalClient: services.temporalClient,
    }),
  ],
})

await startServer(server)

const taskLanguageEngine = await createLanguageEngine({
  services,
  model: "smart",
  sessionPrefix: "sessions",
  systemPrompt: "You implement engineer replica tasks inside prepared repository workspaces.",
})
registerGracefulShutdown(async () => {
  await taskLanguageEngine.stop()
})

const taskActivities = createTaskActivities({
  runtime,
  languageEngine: taskLanguageEngine,
  prisma: services.prisma,
  notificationService: services.notificationService,
  permissionRequestService: services.permissionRequestService,
  accessOperationService: services.accessOperationService,
  provisionService: services.provisionService,
  infraOperationService: services.infraOperationService,
  loadService: services.alphaLoadService,
  alphaOperationService: services.alphaOperationService,
  operationService: services.operationService,
})

await startTemporalWorker({
  services,
  activities: {
    ...services.operationService.activities,
    ...createInteractionActivities(
      services.notificationService,
      services.interactionOperationService,
      services.topicService,
    ),
    ...taskActivities,
  },
})

logger.info("engineer replica server started")
