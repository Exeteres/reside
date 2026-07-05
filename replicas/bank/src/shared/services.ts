import type { Client as TemporalClient } from "@temporalio/client"
import type { Pool } from "pg"
import {
  type CommonServices,
  createCommonServices,
  createPostgresPool,
  createTemporalClient,
} from "@reside/common"
import { bankReplica } from "@reside/registry"
import { PrismaClient } from "../database"

export type BankServices = CommonServices<"access" | "infra" | "interaction"> & {
  pool: Pool
  prisma: PrismaClient
  temporalClient: TemporalClient
}

export async function createServices(): Promise<BankServices> {
  const services = await createCommonServices(bankReplica.endpoints)
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
