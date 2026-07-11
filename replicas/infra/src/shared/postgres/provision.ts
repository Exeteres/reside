import type { Pool } from "pg"
import type { PostgresDatabase } from "../../database"
import type { PostgresAdminConfig } from "./config"
import { Pool as PostgresPool } from "pg"
import { quoteIdentifier, quoteLiteral } from "../utils"
import { buildDatabaseConnectionString } from "./config"
import { POSTGRES_ADMIN_USERNAME } from "./constants"

export function buildReplicaDatabaseName(namespace: string): string {
  return namespace.replaceAll("-", "_")
}

export async function ensureAdminReplicaDatabase(
  adminPool: Pool,
  database: string,
  owner = POSTGRES_ADMIN_USERNAME,
): Promise<void> {
  const existingDatabase = await adminPool.query("SELECT 1 FROM pg_database WHERE datname = $1", [
    database,
  ])

  if ((existingDatabase.rowCount ?? 0) === 0) {
    await adminPool.query(`CREATE DATABASE ${quoteIdentifier(database)}`)
  }

  await adminPool.query(
    `ALTER DATABASE ${quoteIdentifier(database)} OWNER TO ${quoteIdentifier(owner)}`,
  )
  await adminPool.query(
    `GRANT ALL PRIVILEGES ON DATABASE ${quoteIdentifier(database)} TO ${quoteIdentifier(owner)}`,
  )
}

export async function provisionPostgresDatabase(
  adminPool: Pool,
  adminConfig: PostgresAdminConfig,
  postgresDatabase: PostgresDatabase,
): Promise<void> {
  await ensureDatabaseRole(adminPool, postgresDatabase.database, postgresDatabase.password)
  await ensureReplicaDatabase(adminPool, postgresDatabase.database, postgresDatabase.sourceDatabase)
  await ensureDatabaseOwnership(adminConfig, postgresDatabase.database)
}

export async function ensureDatabaseRole(
  adminPool: Pool,
  username: string,
  password: string,
): Promise<void> {
  const existingRole = await adminPool.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [
    username,
  ])

  if (existingRole.rowCount === 0) {
    await adminPool.query(
      `CREATE ROLE ${quoteIdentifier(username)} LOGIN PASSWORD ${quoteLiteral(password)}`,
    )

    return
  }

  await adminPool.query(
    `ALTER ROLE ${quoteIdentifier(username)} LOGIN PASSWORD ${quoteLiteral(password)}`,
  )
}

async function ensureReplicaDatabase(
  adminPool: Pool,
  database: string,
  sourceDatabase: string | null,
): Promise<void> {
  if (sourceDatabase === null) {
    await ensureAdminReplicaDatabase(adminPool, database, database)
    return
  }

  const existingDatabase = await adminPool.query("SELECT 1 FROM pg_database WHERE datname = $1", [
    database,
  ])

  if ((existingDatabase.rowCount ?? 0) === 0) {
    await adminPool.query(
      `CREATE DATABASE ${quoteIdentifier(database)} WITH TEMPLATE ${quoteIdentifier(sourceDatabase)}`,
    )
  }

  await adminPool.query(
    `ALTER DATABASE ${quoteIdentifier(database)} OWNER TO ${quoteIdentifier(database)}`,
  )
  await adminPool.query(
    `GRANT ALL PRIVILEGES ON DATABASE ${quoteIdentifier(database)} TO ${quoteIdentifier(database)}`,
  )
}

async function ensureDatabaseOwnership(
  adminConfig: PostgresAdminConfig,
  database: string,
): Promise<void> {
  const databasePool = new PostgresPool({
    connectionString: buildDatabaseConnectionString(adminConfig, database),
  })

  try {
    await databasePool.query(`ALTER SCHEMA public OWNER TO ${quoteIdentifier(database)}`)
    await databasePool.query(`GRANT ALL ON SCHEMA public TO ${quoteIdentifier(database)}`)
    await databasePool.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${quoteIdentifier(database)}`,
    )
    await databasePool.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ${quoteIdentifier(database)}`,
    )
    await databasePool.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO ${quoteIdentifier(database)}`,
    )
  } finally {
    await databasePool.end()
  }
}
