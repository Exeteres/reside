import { fastifyConnectPlugin } from "@connectrpc/connect-fastify"
import { OperationSubscriptionService } from "@reside/api/common/operation.v1"
import { PingService } from "@reside/api/common/ping.v1"
import { CommandHandlerService } from "@reside/api/interaction/command.v1"
import {
  createCommandHandlerService,
  createInteractionActivities,
  createLanguageEngine,
  createOperationSubscriptionService,
  createPingService,
  createServer,
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
    "After creating a task, report the tool result and message link instead of inventing task status.",
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
  allowedSystemTools: ["bash", "report_intent"],
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
  loadService: services.alphaLoadService,
  alphaOperationService: services.alphaOperationService,
})

await startTemporalWorker({
  services,
  activities: {
    ...createInteractionActivities(
      services.notificationService,
      services.interactionOperationService,
      services.topicService,
    ),
    ...taskActivities,
  },
})

logger.info("engineer replica server started")
