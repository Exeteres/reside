import { createCommonServices, createPostgresPool, createTemporalClient } from "@reside/common"
import { bankReplica } from "@reside/registry"
import { PrismaClient } from "../database"

export async function createServices() {
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
