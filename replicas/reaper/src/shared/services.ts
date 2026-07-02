import type { Client as TemporalClient } from "@temporalio/client"
import type { Pool } from "pg"
import {
  type CommonServices,
  createCommonServices,
  createPostgresPool,
  createTemporalClient,
} from "@reside/common"
import { reaperReplica } from "@reside/registry"
import { PrismaClient } from "../database"

export type ReaperServices = CommonServices<"access" | "infra" | "interaction"> & {
  pool: Pool
  prisma: PrismaClient
  temporalClient: TemporalClient
}

export async function createServices(): Promise<ReaperServices> {
  const services = await createCommonServices(reaperReplica.endpoints)
  const { pool, adapter } = await createPostgresPool(services)
  const prisma = new PrismaClient({ adapter })
  const temporalClient = await createTemporalClient(services)

  return {
    ...services,
    pool,
    prisma,
    temporalClient,
  }
}
