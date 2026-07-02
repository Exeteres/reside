import {
  bootstrapService,
  createCommonServices,
  createPostgresPoolFromCredentials,
  defineCommonResources,
  getReplicaNamespace,
  registerReplica,
  runPrismaMigrations,
} from "@reside/common"
import { infraReplica, WellKnownPermissions } from "@reside/registry"
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
  permissions: [
    {
      name: WellKnownPermissions.INFRA_TEMPORARY_POSTGRES_DATABASE_CREATE,
      title: strings.bootstrap.permissions.temporaryPostgresDatabaseCreate.title,
      description: strings.bootstrap.permissions.temporaryPostgresDatabaseCreate.description,
      scoped: false,
    },
  ],
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

await registerReplica({
  replica: infraReplica,
  title: strings.bootstrap.registration.title,
  description: strings.bootstrap.registration.description,
})

process.exit(0)
