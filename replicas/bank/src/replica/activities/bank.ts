import type { BankActivities } from "../../definitions"
import type { BankServices } from "../../shared"
import { Code, ConnectError } from "@connectrpc/connect"
import { crypto } from "@reside/common"
import { WellKnownPermissions } from "@reside/registry"
import {
  approvePaymentRequest as approvePaymentRequestBusiness,
  failPaymentRequest as failPaymentRequestBusiness,
  getBalance,
  getPendingPaymentRequest as getPendingPaymentRequestBusiness,
  getTelegramWelcomeIdempotencyKey,
  issueReplicaFunds,
  listTransactions,
  rejectPaymentRequest as rejectPaymentRequestBusiness,
  startTelegramWelcomeFundingWorkflow,
  transfer,
} from "../business"

type BankActivityServices = Pick<
  BankServices,
  "authzService" | "operationService" | "prisma" | "temporalClient"
>

export function createBankActivities({
  authzService,
  operationService,
  prisma,
  temporalClient,
}: BankActivityServices): BankActivities {
  const startTelegramWelcomeFunding = async (subjectId: string) =>
    await startTelegramWelcomeFundingWorkflow(temporalClient, subjectId)

  return {
    async getBalance(input) {
      return {
        balance: await getBalance(crypto, prisma, input.subjectId, startTelegramWelcomeFunding),
      }
    },
    async listTransactions(input) {
      return await listTransactions(crypto, prisma, input, startTelegramWelcomeFunding)
    },
    async transfer(input) {
      return {
        transaction: await transfer(crypto, prisma, input, startTelegramWelcomeFunding),
      }
    },
    async issueReplicaFunds(input) {
      const permission = await authzService.checkPermission({
        permissionName: WellKnownPermissions.BANK_ISSUE_REPLICA_FUNDS,
        subjectId: input.callerSubjectId,
      })

      if (!permission.authorized) {
        throw new ConnectError("Missing bank issue permission", Code.PermissionDenied)
      }

      return {
        transaction: await issueReplicaFunds(crypto, prisma, {
          replicaName: input.replicaName,
          amount: input.amount,
          idempotencyKey: input.idempotencyKey,
        }),
      }
    },
    async fundTelegramAccount(input) {
      return {
        transaction: await transfer(crypto, prisma, {
          senderSubjectId: "replica:bank",
          recipientSubjectId: input.subjectId,
          amount: "100",
          idempotencyKey: getTelegramWelcomeIdempotencyKey(input.subjectId),
        }),
      }
    },
    async getPendingPaymentRequest(input) {
      return await getPendingPaymentRequestBusiness(crypto, prisma, input.operationId)
    },
    async approvePaymentRequest(input) {
      const result = await approvePaymentRequestBusiness(crypto, prisma, operationService, input)

      return {
        result: {
          ...result,
          transaction: result.transaction
            ? {
                ...result.transaction,
                comment: undefined,
              }
            : undefined,
        },
      }
    },
    async rejectPaymentRequest(input) {
      return {
        result: await rejectPaymentRequestBusiness(crypto, prisma, operationService, input),
      }
    },
    async failPaymentRequest(input) {
      await failPaymentRequestBusiness(operationService, input)
    },
  }
}
