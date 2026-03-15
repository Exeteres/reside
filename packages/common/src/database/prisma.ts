import type { Pool } from "pg"
import { logger } from "../logger"

/**
 * Runs `prisma migrate deploy` in the replica's directory to apply any pending migrations to the database.
 *
 * @param args Migration execution settings.
 */
export async function runPrismaMigrations(pool: Pool): Promise<void> {
  logger.info("running prisma migrate deploy")

  const processHandle = Bun.spawn(["bun", "prisma", "migrate", "deploy"], {
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: pool.options.connectionString,
    },
  })

  const exitCode = await processHandle.exited
  if (exitCode !== 0) {
    logger.error("prisma migrate deploy failed with exit code %d", exitCode)
    throw new Error("Prisma migrate deploy failed")
  }

  logger.info("prisma migrate deploy completed successfully")
}
