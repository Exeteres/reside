import type { Client as TemporalClient } from "@temporalio/client"
import type { Pool } from "pg"
import {
  type CommonServices,
  createCommonServices,
  createPostgresPool,
  createStorageBucketService,
  createTemporalClient,
  type StorageBucketService,
} from "@reside/common"
import { aiReplica } from "@reside/registry"
import { PrismaClient } from "../database"

export type AiServices = CommonServices<"access" | "infra" | "interaction"> & {
  pool: Pool
  prisma: PrismaClient
  temporalClient: TemporalClient
  storage: StorageBucketService
}

export async function createServices(): Promise<AiServices> {
  const services = await createCommonServices(aiReplica.endpoints)
  const { pool, adapter } = await createPostgresPool(services)
  const prisma = new PrismaClient({ adapter })
  const temporalClient = await createTemporalClient(services)
  const storage = await createStorageBucketService(services)

  return {
    ...services,
    pool,
    prisma,
    temporalClient,
    storage,
  }
}
