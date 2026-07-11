import type { HandlerContext } from "@connectrpc/connect"
import type { BankPaymentServiceImplementation } from "@reside/api/bank/payment.v1"
import type { BankTransaction, PaymentRequestResult } from "../../definitions"
import type { BankServices } from "../../shared"
import { Code, ConnectError } from "@connectrpc/connect"
import { TransactionKind } from "@reside/api/bank/bank.v1_pb"
import { PaymentRequestResultStatus } from "@reside/api/bank/payment.v1_pb"
import { authenticateReplica, crypto } from "@reside/common"
import { WellKnownPermissions } from "@reside/registry"
import { BankNotificationChannels } from "../../definitions"
import { strings } from "../../locale"
import { requestPayment } from "../business"

type BankPaymentServiceDependencies = Pick<
  BankServices,
  "authzService" | "notificationService" | "operationService" | "prisma" | "temporalClient"
>

export function createBankPaymentService({
  authzService,
  notificationService,
  operationService,
  prisma,
  temporalClient,
}: BankPaymentServiceDependencies): BankPaymentServiceImplementation {
  return {
    async requestPayment(request, context: HandlerContext) {
      const identity = await authenticateReplica(context)
      const payerRealm = getSubjectRealm(request.payerSubjectId)
      const permission = await authzService.checkPermission({
        permissionName: WellKnownPermissions.BANK_REQUEST_PAYMENTS,
        subjectId: identity.subjectId,
        scope: payerRealm,
      })

      if (!permission.authorized) {
        throw new ConnectError("Missing bank payment request permission", Code.PermissionDenied)
      }

      const result = await requestPayment(crypto, prisma, temporalClient, {
        requesterSubjectId: identity.subjectId,
        payerSubjectId: request.payerSubjectId,
        amount: request.amount,
        idempotencyKey: request.idempotencyKey,
        comment: request.comment,
      })

      if (result.type === "result") {
        await sendRejectedPaymentNotification({
          notificationService,
          payerSubjectId: request.payerSubjectId,
          result: result.result,
        })

        return {
          response: {
            case: "result",
            value: toApiPaymentRequestResult(result.result),
          },
        }
      }

      return {
        response: {
          case: "operation",
          value: await operationService.toApiOperation(result.operationId),
        },
      }
    },
  }
}

type RejectedPaymentNotificationInput = {
  notificationService: BankPaymentServiceDependencies["notificationService"]
  payerSubjectId: string
  result: PaymentRequestResult
}

export async function sendRejectedPaymentNotification({
  notificationService,
  payerSubjectId,
  result,
}: RejectedPaymentNotificationInput): Promise<void> {
  if (result.status !== "REJECTED" || !result.rejectionReason) {
    return
  }

  await notificationService.sendNotification({
    channel: BankNotificationChannels.PAYMENT_REQUESTS,
    partition: payerSubjectId,
    title: strings.notifications.bank.paymentRequest.title,
    content: strings.notifications.bank.paymentRequest.rejectedWithReason(result.rejectionReason),
    requiresTextResponse: false,
  })
}

function toApiPaymentRequestResult(result: PaymentRequestResult) {
  return {
    status: toApiPaymentRequestResultStatus(result.status),
    transaction: result.transaction ? toApiTransaction(result.transaction) : undefined,
  }
}

function toApiPaymentRequestResultStatus(
  status: PaymentRequestResult["status"],
): PaymentRequestResultStatus {
  if (status === "APPROVED") {
    return PaymentRequestResultStatus.PAYMENT_REQUEST_APPROVED
  }

  if (status === "APPROVED_ALWAYS") {
    return PaymentRequestResultStatus.PAYMENT_REQUEST_APPROVED_ALWAYS
  }

  return PaymentRequestResultStatus.PAYMENT_REQUEST_REJECTED
}

function toApiTransaction(transaction: BankTransaction) {
  return {
    ...transaction,
    kind: transaction.kind === "ISSUE" ? TransactionKind.ISSUE : TransactionKind.TRANSFER,
  }
}

function getSubjectRealm(subjectId: string): string {
  const [realm = "", name = ""] = subjectId.split(":")
  if (!realm || !name) {
    throw new ConnectError(
      'payer_subject_id must be in format "{realm}:{name}"',
      Code.InvalidArgument,
    )
  }

  return realm
}
