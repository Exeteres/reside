import {
  bootstrapService,
  createCommonServices,
  createPostgresPoolFromCredentials,
  defineCommonResources,
  getReplicaNamespace,
  registerReplica,
  runPrismaMigrations,
} from "@reside/common"
import { infraReplica } from "@reside/registry"
import { PrismaClient } from "../database"
import { strings } from "../locale"
import {
  buildReplicaDatabaseName,
  ensureAdminReplicaDatabase,
  loadPostgresAdminConfig,
} from "../shared"
import { ensureMathesarBootstrap } from "./mathesar"
import { ensureMonitoringBootstrap } from "./monitoring"
import { ensureTemporalBootstrap } from "./temporal"

await registerReplica({
  replica: infraReplica,
  title: strings.bootstrap.registration.title,
  description: strings.bootstrap.registration.description,
})

const adminConfig = await loadPostgresAdminConfig()
const { pool: adminPool } = createPostgresPoolFromCredentials(adminConfig)
const replicaDatabase = buildReplicaDatabaseName(getReplicaNamespace())

await ensureAdminReplicaDatabase(adminPool, replicaDatabase, adminConfig.username)

const { pool: replicaPool, adapter } = createPostgresPoolFromCredentials({
  ...adminConfig,
  database: replicaDatabase,
})
const prisma = new PrismaClient({ adapter })

await runPrismaMigrations(replicaPool)
await ensureTemporalBootstrap(prisma)
await ensureMonitoringBootstrap(adminPool, prisma)
await ensureMathesarBootstrap(adminPool, prisma)

await defineCommonResources({
  services: await createCommonServices(infraReplica.endpoints),
  reaperHandlers: [
    {
      resourceReplicaName: "infra",
      title: strings.reaper.title,
    },
  ],
})

await bootstrapService({
  longRunning: true,
})

process.exit(0)
