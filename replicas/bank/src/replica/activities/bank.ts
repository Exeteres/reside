import type { BankActivities } from "../../definitions"
import type { BankServices } from "../../shared"
import { Code, ConnectError } from "@connectrpc/connect"
import { crypto } from "@reside/common"
import { WellKnownPermissions } from "@reside/registry"
import { getBalance, issueReplicaFunds, listTransactions, transfer } from "../business"

type BankActivityServices = Pick<BankServices, "authzService" | "prisma">

export function createBankActivities({
  authzService,
  prisma,
}: BankActivityServices): BankActivities {
  return {
    async getBalance(input) {
      return { balance: await getBalance(crypto, prisma, input.subjectId) }
    },
    async listTransactions(input) {
      return await listTransactions(crypto, prisma, input)
    },
    async transfer(input) {
      return { transaction: await transfer(crypto, prisma, input) }
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
  }
}
