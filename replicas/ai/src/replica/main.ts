import type { ConnectRouter } from "@connectrpc/connect"
import { fastifyConnectPlugin } from "@connectrpc/connect-fastify"
import { PingService } from "@reside/api/common/ping.v1"
import { CommandHandlerService } from "@reside/api/interaction/command.v1"
import {
  createInteractionActivities,
  createPingService,
  createServer,
  crypto,
  logger,
  setupEncryption,
  setupLanguageSubsystem,
  startServer,
  startTemporalWorker,
} from "@reside/common"
import OpenAI from "openai"
import { strings } from "../locale"
import { createServices } from "../shared"
import { createAiActivities } from "./activities"
import { createAiTools } from "./nls"
import { createImageCommandService, createOpenAiImageGenerator } from "./services"

const services = await createServices()

const server = await createServer(services)
const generateImage = createOpenAiImageGenerator(OpenAI, crypto)

await setupEncryption({ services, server })

await server.register(fastifyConnectPlugin, {
  routes(router: ConnectRouter) {
    router.service(
      CommandHandlerService,
      createImageCommandService({
        storage: services.storage,
        notificationService: services.notificationService,
        generateImage,
      }),
    )
    router.service(PingService, createPingService())
  },
})

await setupLanguageSubsystem({
  services,
  server,
  title: strings.bootstrap.registration.title,
  description: strings.bootstrap.registration.description,
  instructions:
    "Create images from user prompts when asked. " +
    "Use create_image for image generation requests. " +
    "Return generated image links, but do not expose internal storage object names.",
  tools: createAiTools(services, generateImage),
})

await startServer(server)

await startTemporalWorker({
  services,
  activities: {
    ...createAiActivities(services),
    ...createInteractionActivities(
      services.notificationService,
      services.interactionOperationService,
    ),
  },
})

logger.info("ai replica started")
