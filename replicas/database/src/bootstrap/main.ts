import {
  bootstrapService,
  createPostgresPoolFromCredentials,
  getReplicaNamespace,
  registerReplica,
  runPrismaMigrations,
} from "@reside/common"
import { databaseReplica } from "@reside/topology"
import { strings } from "../locale"
import {
  buildReplicaDatabaseName,
  ensureAdminReplicaDatabase,
  loadPostgresAdminConfig,
} from "../shared"
import { ensurePostgresBootstrap } from "./postgres"
import { ensureTemporalBootstrap } from "./temporal"

await registerReplica({
  replica: databaseReplica,
  title: strings.bootstrap.registration.title,
  description: strings.bootstrap.registration.description,
})

await ensurePostgresBootstrap()
await ensureTemporalBootstrap()

const adminConfig = await loadPostgresAdminConfig()
const { pool: adminPool } = createPostgresPoolFromCredentials(adminConfig)
const replicaDatabase = buildReplicaDatabaseName(getReplicaNamespace())

await ensureAdminReplicaDatabase(adminPool, replicaDatabase)

const { pool: replicaPool } = createPostgresPoolFromCredentials({
  ...adminConfig,
  database: replicaDatabase,
})

await runPrismaMigrations(replicaPool)
await bootstrapService()
