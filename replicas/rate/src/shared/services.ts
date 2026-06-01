import { createCommonServices, createPostgresPool, createTemporalClient } from "@reside/common"
import { rateReplica } from "@reside/registry"
import { PrismaClient } from "../database"

export async function createServices() {
  const services = await createCommonServices(rateReplica.endpoints)
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
