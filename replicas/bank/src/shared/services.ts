import type { GenericOperationService } from "@reside/common"
import type { Client as TemporalClient } from "@temporalio/client"
import type { Pool } from "pg"
import type { Operation } from "../database"
import {
  type CommonServices,
  createCommonServices,
  createGenericOperationService,
  createPostgresPool,
  createTemporalClient,
  crypto,
} from "@reside/common"
import { bankReplica } from "@reside/registry"
import { PrismaClient } from "../database"
import { getPaymentRequestResult } from "../replica/business"

export type BankServices = CommonServices<"access" | "infra" | "interaction"> & {
  pool: Pool
  prisma: PrismaClient
  temporalClient: TemporalClient
  operationService: GenericOperationService<Operation>
}

export async function createServices(): Promise<BankServices> {
  const services = await createCommonServices(bankReplica.endpoints)
  const { pool, adapter } = await createPostgresPool(services)
  const prisma = new PrismaClient({ adapter })
  const temporalClient = await createTemporalClient(services)
  const operationService = createGenericOperationService({
    prisma,
    temporalClient,
    getResult: async operationId => await getPaymentRequestResult(crypto, prisma, operationId),
  })

  return {
    ...services,
    pool,
    prisma,
    temporalClient,
    operationService,
  }
}
