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
import { ENGINEER_FACTORY_INTERNAL_ENDPOINT } from "../definitions"
import { strings } from "../locale"
import { createServices } from "../shared"
import { createTaskActivities } from "./activities"
import { createFactoryEnvironment, startGitHubService } from "./business"
import { createCreateTaskTool } from "./nls"
import { createReaperService } from "./services/reaper"

const services = await createServices()
const github = await startGitHubService()
registerGracefulShutdown(async () => {
  await github.stop()
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
    'When the user asks you to plan a task, never plan it yourself in chat; call reside_create_task with mode="plan" and put the full request in the task field. ' +
    'When the user explicitly asks you to implement directly, call reside_create_task with mode="implement". ' +
    "After reside_create_task succeeds, reply with the returned messageLink as the place where the task continues. " +
    "Do not claim that planning or implementation finished merely because the task workflow was started. " +
    'If reside_create_task returns status="failed" or any error field, state that task creation failed, include the returned error, and do not say that anything was planned, created, started, or scheduled.',
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
  sessionPrefix: "tasks",
  systemPrompt: "You implement engineer replica tasks inside prepared repository workspaces.",
  opencodeEndpoint: ENGINEER_FACTORY_INTERNAL_ENDPOINT,
})
registerGracefulShutdown(async () => {
  await taskLanguageEngine.stop()
})

const taskActivities = createTaskActivities({
  github,
  createFactoryEnvironment,
  languageEngine: taskLanguageEngine,
  prisma: services.prisma,
  notificationService: services.notificationService,
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
