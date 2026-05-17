import {
  bootstrapService,
  createPostgresPoolFromCredentials,
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
import { ensureMinioBootstrap } from "./minio"
import { ensureMonitoringBootstrap } from "./monitoring"
import { ensurePostgresBootstrap } from "./postgres"
import { ensureTemporalBootstrap } from "./temporal"

await registerReplica({
  replica: infraReplica,
  title: strings.bootstrap.registration.title,
  description: strings.bootstrap.registration.description,
})

await ensurePostgresBootstrap()
await ensureTemporalBootstrap()

const adminConfig = await loadPostgresAdminConfig()
const { pool: adminPool } = createPostgresPoolFromCredentials(adminConfig)
const replicaDatabase = buildReplicaDatabaseName(getReplicaNamespace())

await ensureAdminReplicaDatabase(adminPool, replicaDatabase)

const { pool: replicaPool, adapter } = createPostgresPoolFromCredentials({
  ...adminConfig,
  database: replicaDatabase,
})
const prisma = new PrismaClient({ adapter })

await runPrismaMigrations(replicaPool)
await ensureMinioBootstrap(prisma)
await ensureMonitoringBootstrap(adminPool, prisma)
await ensureMathesarBootstrap(adminPool, prisma)

await bootstrapService({
  longRunning: true,
})

process.exit(0)
