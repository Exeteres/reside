import type { ConnectRouter } from "@connectrpc/connect"
import { create } from "@bufbuild/protobuf"
import { fastifyConnectPlugin } from "@connectrpc/connect-fastify"
import { PingService } from "@reside/api/common/ping.v1"
import { CommandHandlerService } from "@reside/api/interaction/command.v1"
import { NotcompelService, SendImageRequestSchema } from "@reside/api/notcompel/notcompel.v1"
import {
  createCommandHandlerService,
  createInteractionActivities,
  createPingService,
  createServer,
  logger,
  setupEncryption,
  setupLanguageSubsystem,
  startServer,
  startTemporalWorker,
} from "@reside/common"
import { strings } from "../locale"
import { createServices } from "../shared"
import { createNotcompelActivities } from "./activities"
import { createNotcompelTools } from "./nls"
import { createNotcompelService } from "./services"

const shouldRunOnStart = process.env.NOTCOMPEL_RUN_ON_START === "true"

const services = await createServices()
const notcompelService = createNotcompelService(services)

if (shouldRunOnStart) {
  await notcompelService.sendImage(create(SendImageRequestSchema), undefined as never)
  logger.info("notcompel startup image send completed")
  process.exit(0)
}

const server = await createServer(services)

await setupEncryption({ services, server })

await server.register(fastifyConnectPlugin, {
  routes(router: ConnectRouter) {
    router.service(CommandHandlerService, createCommandHandlerService(services.temporalClient))
    router.service(NotcompelService, notcompelService)
    router.service(PingService, createPingService())
  },
})

await setupLanguageSubsystem({
  services,
  server,
  title: strings.bootstrap.registration.title,
  description: strings.bootstrap.registration.description,
  instructions:
    "Help users send the current notcompel.ru image to the system chat. " +
    "Use send_notcompel_image when the user asks to send, publish, or trigger the Notcompel image. " +
    "Do not claim that an image was sent unless the tool or API result confirms it.",
  tools: createNotcompelTools(services),
})

await startServer(server)

await startTemporalWorker({
  services,
  activities: {
    ...createNotcompelActivities(services),
    ...createInteractionActivities(
      services.notificationService,
      services.interactionOperationService,
    ),
  },
})

logger.info("notcompel replica started")
