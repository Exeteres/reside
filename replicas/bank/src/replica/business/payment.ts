import type { GenericOperationService, ResideCrypto } from "@reside/common"
import type { Client as TemporalClient } from "@temporalio/client"
import type { Operation, PrismaClient } from "../../database"
import type { BankTransaction, PaymentRequestResult } from "../../definitions"
import { DEFAULT_TEMPORAL_TASK_QUEUE } from "@reside/common"
import { WorkflowIdReusePolicy } from "@temporalio/client"
import { OperationType } from "../../database"
import {
  BankError,
  getPaymentRequestWorkflowId,
  PAYMENT_REQUEST_WORKFLOW_TYPE,
} from "../../definitions"
import { strings } from "../../locale"
import {
  decryptAmount,
  encryptedCommentSchema,
  mapTransaction,
  parsePositiveAmount,
  transfer,
} from "./bank"

export type BankPaymentPrisma = PrismaClient

export type RequestPaymentInput = {
  requesterSubjectId: string
  payerSubjectId: string
  amount: string
  idempotencyKey: string
  comment?: string
}

export type RequestPaymentOutput =
  | {
      type: "result"
      result: PaymentRequestResult
    }
  | {
      type: "operation"
      operationId: number
    }

export type PaymentAuthorizationSummary = {
  id: number
  requesterSubjectId: string
  createdAt: string
}

export async function listPaymentAuthorizations(
  prisma: BankPaymentPrisma,
  payerSubjectId: string,
): Promise<PaymentAuthorizationSummary[]> {
  const authorizations = await prisma.paymentAuthorization.findMany({
    where: { payerSubjectId },
    orderBy: [{ id: "asc" }],
  })

  return authorizations.map(authorization => ({
    id: authorization.id,
    requesterSubjectId: authorization.requesterSubjectId,
    createdAt: authorization.createdAt.toISOString(),
  }))
}

export async function cancelPaymentAuthorization(
  prisma: BankPaymentPrisma,
  input: { payerSubjectId: string; authorizationId: number },
): Promise<PaymentAuthorizationSummary | undefined> {
  const authorization = await prisma.paymentAuthorization.findFirst({
    where: {
      id: input.authorizationId,
      payerSubjectId: input.payerSubjectId,
    },
  })

  if (!authorization) {
    return undefined
  }

  await prisma.paymentAuthorization.delete({ where: { id: authorization.id } })

  return {
    id: authorization.id,
    requesterSubjectId: authorization.requesterSubjectId,
    createdAt: authorization.createdAt.toISOString(),
  }
}

export async function requestPayment(
  crypto: ResideCrypto,
  prisma: BankPaymentPrisma,
  temporalClient: TemporalClient,
  input: RequestPaymentInput,
): Promise<RequestPaymentOutput> {
  parsePositiveAmount(input.amount)

  if (input.requesterSubjectId === input.payerSubjectId) {
    throw new BankError(strings.errors.differentTransferSubjects)
  }

  const existing = await prisma.paymentRequest.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    include: { operation: true, transaction: true },
  })

  if (existing) {
    await assertSamePaymentRequestPayload(crypto, existing, input)

    if (existing.status === "REJECTED") {
      return {
        type: "result",
        result: { status: "REJECTED" },
      }
    }

    if (existing.transaction) {
      return {
        type: "result",
        result: {
          status: toCompletedResultStatus(existing.status),
          transaction: await mapTransaction(crypto, existing.transaction),
        },
      }
    }

    return {
      type: "operation",
      operationId: existing.operationId,
    }
  }

  const authorization = await prisma.paymentAuthorization.findUnique({
    where: {
      payerSubjectId_requesterSubjectId: {
        payerSubjectId: input.payerSubjectId,
        requesterSubjectId: input.requesterSubjectId,
      },
    },
  })

  if (authorization) {
    const amountEcid = await crypto.encrypt(input.amount)
    const commentEcid = input.comment ? await crypto.encrypt(input.comment) : undefined

    let transaction: BankTransaction | undefined
    try {
      transaction = await transfer(crypto, prisma, {
        senderSubjectId: input.payerSubjectId,
        recipientSubjectId: input.requesterSubjectId,
        amount: input.amount,
        idempotencyKey: `payment:${input.idempotencyKey}`,
        comment: input.comment,
      })
    } catch (error) {
      if (!(error instanceof BankError)) {
        throw error
      }

      const operation = await prisma.operation.create({
        data: {
          title: strings.notifications.bank.paymentRequest.operationTitle,
          description: strings.notifications.bank.paymentRequest.operationDescription(
            input.amount,
            input.requesterSubjectId,
          ),
          type: OperationType.PAYMENT_REQUEST,
          status: "COMPLETED",
          resolvedAt: new Date(),
        },
      })

      await prisma.paymentRequest.create({
        data: {
          operationId: operation.id,
          payerSubjectId: input.payerSubjectId,
          requesterSubjectId: input.requesterSubjectId,
          amountEcid,
          idempotencyKey: input.idempotencyKey,
          commentEcid,
          status: "REJECTED",
          resolvedAt: new Date(),
        },
      })

      return {
        type: "result",
        result: {
          status: "REJECTED",
          rejectionReason: error.reason,
        },
      }
    }

    const operation = await prisma.operation.create({
      data: {
        title: strings.notifications.bank.paymentRequest.operationTitle,
        description: strings.notifications.bank.paymentRequest.operationDescription(
          input.amount,
          input.requesterSubjectId,
        ),
        type: OperationType.PAYMENT_REQUEST,
        status: "COMPLETED",
        resolvedAt: new Date(),
      },
    })

    await prisma.paymentRequest.create({
      data: {
        operationId: operation.id,
        payerSubjectId: input.payerSubjectId,
        requesterSubjectId: input.requesterSubjectId,
        amountEcid,
        idempotencyKey: input.idempotencyKey,
        commentEcid,
        status: "APPROVED_ALWAYS",
        transactionId: BigInt(transaction.id),
        resolvedAt: new Date(),
      },
    })

    return {
      type: "result",
      result: {
        status: "APPROVED_ALWAYS",
        transaction,
      },
    }
  }

  const amountEcid = await crypto.encrypt(input.amount)
  const commentEcid = input.comment ? await crypto.encrypt(input.comment) : undefined
  const created = await prisma.$transaction(async tx => {
    const operation = await tx.operation.create({
      data: {
        title: strings.notifications.bank.paymentRequest.operationTitle,
        description: strings.notifications.bank.paymentRequest.operationDescription(
          input.amount,
          input.requesterSubjectId,
        ),
        type: OperationType.PAYMENT_REQUEST,
      },
    })

    await tx.paymentRequest.create({
      data: {
        operationId: operation.id,
        payerSubjectId: input.payerSubjectId,
        requesterSubjectId: input.requesterSubjectId,
        amountEcid,
        idempotencyKey: input.idempotencyKey,
        commentEcid,
      },
    })

    return operation
  })

  await temporalClient.workflow.start(PAYMENT_REQUEST_WORKFLOW_TYPE, {
    args: [{ operationId: created.id }],
    taskQueue: DEFAULT_TEMPORAL_TASK_QUEUE,
    workflowId: getPaymentRequestWorkflowId(created.id),
    workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY,
  })

  return {
    type: "operation",
    operationId: created.id,
  }
}

export async function getPaymentRequestResult(
  crypto: ResideCrypto,
  prisma: BankPaymentPrisma,
  operationId: number,
): Promise<PaymentRequestResult> {
  const paymentRequest = await prisma.paymentRequest.findUnique({
    where: { operationId },
    include: { transaction: true },
  })

  if (!paymentRequest) {
    throw new Error(`Payment request for operation "${operationId}" was not found`)
  }

  if (paymentRequest.status === "REJECTED") {
    return { status: "REJECTED" }
  }

  if (!paymentRequest.transaction) {
    throw new BankError(strings.errors.paymentRequestMissingTransaction)
  }

  return {
    status: toCompletedResultStatus(paymentRequest.status),
    transaction: await mapTransaction(crypto, paymentRequest.transaction),
  }
}

export async function getPendingPaymentRequest(
  crypto: ResideCrypto,
  prisma: BankPaymentPrisma,
  operationId: number,
): Promise<{
  payerSubjectId: string
  requesterSubjectId: string
  amount: string
  commentEcid?: string
}> {
  const paymentRequest = await prisma.paymentRequest.findUnique({ where: { operationId } })
  if (!paymentRequest) {
    throw new Error(`Payment request for operation "${operationId}" was not found`)
  }

  return {
    payerSubjectId: paymentRequest.payerSubjectId,
    requesterSubjectId: paymentRequest.requesterSubjectId,
    amount: await decryptAmount(crypto, paymentRequest.amountEcid),
    commentEcid: paymentRequest.commentEcid ?? undefined,
  }
}

function toCompletedResultStatus(status: "APPROVED" | "APPROVED_ALWAYS" | "PENDING") {
  if (status === "PENDING") {
    throw new BankError(strings.errors.paymentRequestMissingTransaction)
  }

  return status
}

export async function approvePaymentRequest(
  crypto: ResideCrypto,
  prisma: BankPaymentPrisma,
  operationService: GenericOperationService<Operation>,
  input: { operationId: number; approveAlways: boolean },
): Promise<PaymentRequestResult> {
  const paymentRequest = await prisma.paymentRequest.findUnique({
    where: { operationId: input.operationId },
  })
  if (!paymentRequest) {
    throw new Error(`Payment request for operation "${input.operationId}" was not found`)
  }

  if (paymentRequest.status !== "PENDING") {
    return await getPaymentRequestResult(crypto, prisma, input.operationId)
  }

  const amount = await decryptAmount(crypto, paymentRequest.amountEcid)
  const comment = paymentRequest.commentEcid
    ? await crypto.decrypt(encryptedCommentSchema, paymentRequest.commentEcid)
    : undefined

  let transaction: BankTransaction | undefined
  try {
    transaction = await transfer(crypto, prisma, {
      senderSubjectId: paymentRequest.payerSubjectId,
      recipientSubjectId: paymentRequest.requesterSubjectId,
      amount,
      idempotencyKey: `payment:${paymentRequest.idempotencyKey}`,
      comment,
    })
  } catch (error) {
    if (!(error instanceof BankError)) {
      throw error
    }

    await prisma.paymentRequest.update({
      where: { operationId: input.operationId },
      data: {
        status: "REJECTED",
        resolvedAt: new Date(),
      },
    })

    // expected payment rejection is a completed business result, not an operation failure
    await operationService.setCompleted(input.operationId)

    return { status: "REJECTED", rejectionReason: error.reason }
  }

  const status = input.approveAlways ? "APPROVED_ALWAYS" : "APPROVED"

  if (input.approveAlways) {
    await prisma.paymentAuthorization.upsert({
      where: {
        payerSubjectId_requesterSubjectId: {
          payerSubjectId: paymentRequest.payerSubjectId,
          requesterSubjectId: paymentRequest.requesterSubjectId,
        },
      },
      create: {
        payerSubjectId: paymentRequest.payerSubjectId,
        requesterSubjectId: paymentRequest.requesterSubjectId,
      },
      update: {},
    })
  }

  await prisma.paymentRequest.update({
    where: { operationId: input.operationId },
    data: {
      status,
      transactionId: BigInt(transaction.id),
      resolvedAt: new Date(),
    },
  })
  await operationService.setCompleted(input.operationId)

  return { status, transaction }
}

export async function rejectPaymentRequest(
  crypto: ResideCrypto,
  prisma: BankPaymentPrisma,
  operationService: GenericOperationService<Operation>,
  input: { operationId: number },
): Promise<PaymentRequestResult> {
  const paymentRequest = await prisma.paymentRequest.findUnique({
    where: { operationId: input.operationId },
  })
  if (!paymentRequest) {
    throw new Error(`Payment request for operation "${input.operationId}" was not found`)
  }

  if (paymentRequest.status !== "PENDING") {
    return await getPaymentRequestResult(crypto, prisma, input.operationId)
  }

  await prisma.paymentRequest.update({
    where: { operationId: input.operationId },
    data: {
      status: "REJECTED",
      resolvedAt: new Date(),
    },
  })
  await operationService.setCompleted(input.operationId)

  return { status: "REJECTED" }
}

export async function failPaymentRequest(
  operationService: GenericOperationService<Operation>,
  input: { operationId: number; failureMessage: string },
): Promise<void> {
  await operationService.setFailed(
    input.operationId,
    "PAYMENT_REQUEST_FAILED",
    input.failureMessage,
  )
}

async function assertSamePaymentRequestPayload(
  crypto: ResideCrypto,
  paymentRequest: {
    payerSubjectId: string
    requesterSubjectId: string
    amountEcid: string
    commentEcid: string | null
  },
  input: RequestPaymentInput,
): Promise<void> {
  const amount = await decryptAmount(crypto, paymentRequest.amountEcid)
  const comment = paymentRequest.commentEcid
    ? await crypto.decrypt(encryptedCommentSchema, paymentRequest.commentEcid)
    : undefined

  if (
    paymentRequest.payerSubjectId !== input.payerSubjectId ||
    paymentRequest.requesterSubjectId !== input.requesterSubjectId ||
    amount !== input.amount ||
    comment !== input.comment
  ) {
    throw new BankError(strings.errors.paymentRequestPayloadMismatch)
  }
}
