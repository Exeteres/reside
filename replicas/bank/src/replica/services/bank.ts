import type { HandlerContext } from "@connectrpc/connect"
import type { BankServiceImplementation } from "@reside/api/bank/bank.v1"
import type { BankTransaction } from "../../definitions"
import type { BankServices } from "../../shared"
import { TransactionKind } from "@reside/api/bank/bank.v1_pb"
import { authenticateReplica, crypto } from "@reside/common"
import { getBalance, listTransactions, transfer } from "../business"

type BankServiceDependencies = Pick<BankServices, "prisma">

export function createBankService({ prisma }: BankServiceDependencies): BankServiceImplementation {
  return {
    async getBalance(_request, context: HandlerContext) {
      const identity = await authenticateReplica(context)

      return { balance: await getBalance(crypto, prisma, identity.subjectId) }
    },
    async listTransactions(request, context: HandlerContext) {
      const identity = await authenticateReplica(context)
      const result = await listTransactions(crypto, prisma, {
        subjectId: identity.subjectId,
        pageSize: request.pageSize,
        pageToken: request.pageToken,
      })

      return {
        transactions: result.transactions.map(toApiTransaction),
        nextPageToken: result.nextPageToken,
      }
    },
    async transfer(request, context: HandlerContext) {
      const identity = await authenticateReplica(context)
      const transaction = await transfer(crypto, prisma, {
        senderSubjectId: identity.subjectId,
        recipientSubjectId: request.recipientSubjectId,
        amount: request.amount,
        idempotencyKey: request.idempotencyKey,
        comment: request.comment,
      })

      return { transaction: toApiTransaction(transaction) }
    },
  }
}

function toApiTransaction(transaction: BankTransaction) {
  return {
    ...transaction,
    kind: transaction.kind === "ISSUE" ? TransactionKind.ISSUE : TransactionKind.TRANSFER,
  }
}
