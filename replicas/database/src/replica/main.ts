import { startService } from "@reside/api"
import { OperationServiceDefinition } from "@reside/api/common/operation.v1"
import { ProvisionServiceDefinition } from "@reside/api/database/provision.v1"
import { logger, runTemporalWorker } from "@reside/common"
import { createServer } from "nice-grpc"
import { createReplicaDatabaseOptions, createServices } from "../shared"
import { createDatabaseActivities } from "./activities"
import { createProvisionService } from "./services/provision"

const { adminConfig, adminPool, prisma, temporalClient, operationService } = await createServices()

const server = createServer()

server.add(
  ProvisionServiceDefinition,
  createProvisionService(prisma, adminConfig, temporalClient, operationService),
)

server.add(OperationServiceDefinition, operationService.implementation)

await startService(server)

await operationService.startOperationWorker({
  ...createReplicaDatabaseOptions(),
})

await runTemporalWorker({
  ...createReplicaDatabaseOptions(),
  createActivities: ({ connection }) => {
    return createDatabaseActivities(
      prisma,
      adminPool,
      adminConfig,
      connection.workflowService,
      operationService,
    )
  },
})

logger.info("database replica started")
