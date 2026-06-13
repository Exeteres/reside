import type { CommonServices } from "../services"
import { PrismaPg } from "@prisma/adapter-pg"
import { waitForResult } from "@reside/api"
import { Pool } from "pg"
import { logger } from "../logger"
import { registerGracefulShutdown } from "../utils"

export type PostgresConnectionCredentials = {
  host: string
  port: number
  database: string
  username: string
  password: string
}

export type PostgresPool = {
  /**
   * The PostgreSQL connection pool instance.
   */
  pool: Pool

  /**
   * The prisma adapter for the PostgreSQL connection pool.
   */
  adapter: PrismaPg
}

/**
 * Creates a PostgreSQL connection pool configured with ReSide's standard settings.
 *
 * @returns The configured PostgreSQL connection pool.
 */
export async function createPostgresPool(services: CommonServices<"infra">): Promise<PostgresPool> {
  try {
    logger.info("requesting PostgreSQL credentials from database provision service")

    const response = await services.provisionService.getPostgresDatabaseCredentials({})
    if (!response.credentials) {
      throw new Error("Server did not return database credentials")
    }
    if (response.credentials.case === undefined) {
      throw new Error("Server returned empty database credentials response")
    }

    const credentials = await waitForResult(response.credentials, services.infraOperationService)
    if (!credentials) {
      throw new Error("Server did not return resolved database credentials")
    }

    logger.info(
      'received PostgreSQL credentials for host "%s" and database "%s"',
      credentials.host,
      credentials.database,
    )

    return createPostgresPoolFromCredentials(credentials)
  } catch (error) {
    logger.error({ error }, "failed to create PostgreSQL pool")
    throw new Error("Failed to create PostgreSQL pool", { cause: error })
  }
}

/**
 * Creates a PostgreSQL connection pool from the given database credentials.
 *
 * @param credentials The credentials to connect to the PostgreSQL database.
 * @returns The configured PostgreSQL connection pool.
 */
export function createPostgresPoolFromCredentials(
  credentials: PostgresConnectionCredentials,
): PostgresPool {
  logger.info(
    'creating PostgreSQL pool for host "%s" and database "%s"',
    credentials.host,
    credentials.database,
  )

  const pool = new Pool({
    connectionString: buildConnectionString(credentials),
    // TODO: configure TLS
    ssl: false,
  })

  registerGracefulShutdown(() => pool.end())

  return {
    pool,
    adapter: new PrismaPg(pool),
  }
}

function buildConnectionString(args: PostgresConnectionCredentials): string {
  const connectionUrl = new URL("postgresql://placeholder")
  connectionUrl.hostname = args.host
  connectionUrl.port = `${args.port}`
  connectionUrl.username = args.username
  connectionUrl.password = args.password
  connectionUrl.pathname = `/${args.database}`

  return connectionUrl.toString()
}
