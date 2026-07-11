import type { ResideCrypto } from "@reside/common/encryption"
import type { Client as TemporalClient } from "@temporalio/client"
import type { Pool } from "pg"
import { BankService, type BankServiceClient } from "@reside/api/bank/bank.v1"
import { BankPaymentService, type BankPaymentServiceClient } from "@reside/api/bank/payment.v1"
import { OperationService, type OperationServiceClient } from "@reside/api/common/operation.v1"
import {
  type CommonServices,
  createClient,
  createCommonServices,
  createPostgresPool,
  createTemporalClient,
} from "@reside/common"
import { crypto } from "@reside/common/encryption"
import { casinoReplica } from "@reside/registry"
import { PrismaClient } from "../database"

export type CasinoServices = CommonServices<"access" | "infra" | "interaction" | "bank"> & {
  pool: Pool
  prisma: PrismaClient
  temporalClient: TemporalClient
  crypto: ResideCrypto
  bankService: BankServiceClient
  bankPaymentService: BankPaymentServiceClient
  bankOperationService: OperationServiceClient
}

export async function createServices(): Promise<CasinoServices> {
  const services = await createCommonServices(casinoReplica.endpoints)
  const { pool, adapter } = await createPostgresPool(services)
  const prisma = new PrismaClient({ adapter })
  const temporalClient = await createTemporalClient(services)
  const bankService = createClient(BankService, services.channels.bank)
  const bankPaymentService = createClient(BankPaymentService, services.channels.bank)
  const bankOperationService = createClient(OperationService, services.channels.bank)

  return {
    ...services,
    pool,
    prisma,
    temporalClient,
    crypto,
    bankService,
    bankPaymentService,
    bankOperationService,
  }
}
