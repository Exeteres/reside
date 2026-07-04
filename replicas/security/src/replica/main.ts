import { fastifyConnectPlugin } from "@connectrpc/connect-fastify"
import { ApprovalService } from "@reside/api/common/approval.v1"
import { OperationService, OperationSubscriptionService } from "@reside/api/common/operation.v1"
import { PingService } from "@reside/api/common/ping.v1"
import {
  createLanguageActivities,
  createOperationSubscriptionService,
  createPingService,
  createServer,
  logger,
  setupEncryption,
  setupLanguageSubsystem,
  startServer,
  startTemporalWorker,
} from "@reside/common"
import { APPROVAL_MEMORY_TAGS, buildSecuritySystemPrompt } from "../definitions"
import { strings } from "../locale"
import { createServices } from "../shared"
import { createSecurityActivities } from "./activities"
import { createApprovalDecisionTools } from "./nls"
import { createApprovalService } from "./services"

const services = await createServices()

const server = await createServer(services)

await setupEncryption({ services, server })

await server.register(fastifyConnectPlugin, {
  routes(router) {
    router.service(ApprovalService, createApprovalService(services))
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
  instructions:
    "Help users evolve approval rules safely. " +
    "Ask clarifying questions when allow, deny, escalation, or risk intent is ambiguous. " +
    "When saving memory notes for decision rules, always tag allow-rules with allow and escalation/risk-rules with escalate. " +
    "Do not mix tags in a single rule note. " +
    "Do not reveal or infer private subject identity beyond opaque IDs.",
  tags: APPROVAL_MEMORY_TAGS,
})

await startServer(server)

const decisionTools = createApprovalDecisionTools()

const languageActivities = await createLanguageActivities({
  services,
  model: "smart",
  sessionPrefix: "approvals",
  systemPrompt: buildSecuritySystemPrompt(),
  tools: decisionTools.tools,
  tags: APPROVAL_MEMORY_TAGS,
})

await startTemporalWorker({
  services,
  activities: {
    ...services.operationService.activities,
    ...languageActivities,
    ...createSecurityActivities({
      prisma: services.prisma,
      operationService: services.operationService,
      askLanguageEngine: languageActivities.askLanguageEngine,
      consumeDecision: decisionTools.consumeDecision,
    }),
  },
})

logger.info("security replica started")
