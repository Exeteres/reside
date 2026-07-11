import type { GenericOperationService, ResideCrypto } from "@reside/common"
import type { Client as TemporalClient } from "@temporalio/client"
import type { Operation } from "../../database"
import type { BankPaymentPrisma } from "./payment"
import { describe, expect, mock, test } from "bun:test"
import {
  approvePaymentRequest,
  cancelPaymentAuthorization,
  getPaymentRequestResult,
  listPaymentAuthorizations,
  rejectPaymentRequest,
  requestPayment,
} from "./payment"

const baseInput = {
  requesterSubjectId: "replica:casino",
  payerSubjectId: "telegram:1",
  amount: "7",
  idempotencyKey: "bet:1",
  comment: "Ставка",
}

describe("payment requests", () => {
  test("rejects non-positive amounts", () => {
    expect(
      requestPayment({} as ResideCrypto, {} as BankPaymentPrisma, {} as TemporalClient, {
        ...baseInput,
        amount: "0",
      }),
    ).rejects.toThrow("Сумма должна быть положительной")
  })

  test("rejects requests from a subject to itself", () => {
    expect(
      requestPayment({} as ResideCrypto, {} as BankPaymentPrisma, {} as TemporalClient, {
        ...baseInput,
        requesterSubjectId: "telegram:1",
        payerSubjectId: "telegram:1",
      }),
    ).rejects.toThrow("Отправитель и получатель должны отличаться")
  })

  test("creates pending operation and starts confirmation workflow", async () => {
    const crypto = createCrypto()
    const operationCreate = mock(async () => ({ id: 42 }))
    const paymentRequestCreate = mock(async () => ({}))
    const workflowStart = mock(async () => ({}))
    const prisma = {
      paymentRequest: {
        findUnique: mock(async () => null),
      },
      paymentAuthorization: {
        findUnique: mock(async () => null),
      },
      $transaction: mock(
        async callback =>
          await callback({
            operation: { create: operationCreate },
            paymentRequest: { create: paymentRequestCreate },
          }),
      ),
    } as unknown as BankPaymentPrisma
    const temporalClient = {
      workflow: {
        start: workflowStart,
      },
    } as unknown as TemporalClient

    const result = await requestPayment(crypto, prisma, temporalClient, baseInput)

    expect(result).toEqual({ type: "operation", operationId: 42 })
    expect(paymentRequestCreate).toHaveBeenCalledWith({
      data: {
        operationId: 42,
        payerSubjectId: "telegram:1",
        requesterSubjectId: "replica:casino",
        amountEcid: "enc:7",
        idempotencyKey: "bet:1",
        commentEcid: "enc:Ставка",
      },
    })
    expect(workflowStart).toHaveBeenCalledWith("confirmPaymentRequestWorkflow", {
      args: [{ operationId: 42 }],
      taskQueue: "default",
      workflowId: "payment-request-42",
      workflowIdReusePolicy: "ALLOW_DUPLICATE_FAILED_ONLY",
    })
  })

  test("rejects authorized request when payer funds are insufficient", async () => {
    const crypto = createCrypto()
    const operationCreate = mock(async () => ({ id: 42 }))
    const paymentRequestCreate = mock(async () => ({}))
    const prisma = {
      paymentRequest: {
        findUnique: mock(async () => null),
        create: paymentRequestCreate,
      },
      paymentAuthorization: {
        findUnique: mock(async () => ({ id: 1 })),
      },
      operation: {
        create: operationCreate,
      },
      $transaction: mock(
        async callback =>
          await callback({
            transaction: {
              findUnique: mock(async () => null),
            },
            account: {
              findUnique: mock(async ({ where }: { where: { subject_id: string } }) => ({
                subject_id: where.subject_id,
                balanceEcid: where.subject_id === "telegram:1" ? "enc:2" : "enc:0",
              })),
            },
          }),
      ),
    } as unknown as BankPaymentPrisma

    const result = await requestPayment(crypto, prisma, {} as TemporalClient, baseInput)

    expect(result).toEqual({ type: "result", result: { status: "REJECTED" } })
    expect(paymentRequestCreate).toHaveBeenCalledWith({
      data: {
        operationId: 42,
        payerSubjectId: "telegram:1",
        requesterSubjectId: "replica:casino",
        amountEcid: "enc:7",
        idempotencyKey: "bet:1",
        commentEcid: "enc:Ставка",
        status: "REJECTED",
        resolvedAt: expect.any(Date),
      },
    })
  })

  test("returns existing pending operation for idempotent retry", async () => {
    const crypto = createCrypto()
    const prisma = {
      paymentRequest: {
        findUnique: mock(async () => ({
          operationId: 42,
          payerSubjectId: "telegram:1",
          requesterSubjectId: "replica:casino",
          amountEcid: "enc:7",
          commentEcid: "enc:Ставка",
          status: "PENDING",
          transaction: null,
        })),
      },
    } as unknown as BankPaymentPrisma

    const result = await requestPayment(crypto, prisma, {} as TemporalClient, baseInput)

    expect(result).toEqual({ type: "operation", operationId: 42 })
  })

  test("rejects idempotency key reuse with different payload", () => {
    const crypto = createCrypto()
    const prisma = {
      paymentRequest: {
        findUnique: mock(async () => ({
          operationId: 42,
          payerSubjectId: "telegram:1",
          requesterSubjectId: "replica:casino",
          amountEcid: "enc:8",
          commentEcid: "enc:Ставка",
          status: "PENDING",
          transaction: null,
        })),
      },
    } as unknown as BankPaymentPrisma

    expect(requestPayment(crypto, prisma, {} as TemporalClient, baseInput)).rejects.toThrow(
      "Ключ идемпотентности уже использован для другого запроса оплаты",
    )
  })

  test("approves pending request and persists always authorization", async () => {
    const crypto = createCrypto()
    const paymentAuthorizationUpsert = mock(async () => ({}))
    const paymentRequestUpdate = mock(async () => ({}))
    const operationSetCompleted = mock(async () => ({}))
    const prisma = createApprovalPrisma({
      paymentAuthorizationUpsert,
      paymentRequestUpdate,
    })
    const operationService = {
      setCompleted: operationSetCompleted,
    } as unknown as GenericOperationService<Operation>

    const result = await approvePaymentRequest(crypto, prisma, operationService, {
      operationId: 42,
      approveAlways: true,
    })

    expect(result.status).toBe("APPROVED_ALWAYS")
    expect(result.transaction?.id).toBe("99")
    expect(paymentAuthorizationUpsert).toHaveBeenCalledWith({
      where: {
        payerSubjectId_requesterSubjectId: {
          payerSubjectId: "telegram:1",
          requesterSubjectId: "replica:casino",
        },
      },
      create: {
        payerSubjectId: "telegram:1",
        requesterSubjectId: "replica:casino",
      },
      update: {},
    })
    expect(paymentRequestUpdate).toHaveBeenCalledWith({
      where: { operationId: 42 },
      data: {
        status: "APPROVED_ALWAYS",
        transactionId: 99n,
        resolvedAt: expect.any(Date),
      },
    })
    expect(operationSetCompleted).toHaveBeenCalledWith(42)
  })

  test("rejects approved pending request when payer funds are insufficient", async () => {
    const crypto = createCrypto()
    const paymentRequestUpdate = mock(async () => ({}))
    const paymentAuthorizationUpsert = mock(async () => ({}))
    const operationSetCompleted = mock(async () => ({}))
    const prisma = createApprovalPrisma({
      paymentAuthorizationUpsert,
      paymentRequestUpdate,
      payerBalanceEcid: "enc:2",
    })
    const operationService = {
      setCompleted: operationSetCompleted,
    } as unknown as GenericOperationService<Operation>

    const result = await approvePaymentRequest(crypto, prisma, operationService, {
      operationId: 42,
      approveAlways: true,
    })

    expect(result).toEqual({ status: "REJECTED" })
    expect(paymentAuthorizationUpsert).not.toHaveBeenCalled()
    expect(paymentRequestUpdate).toHaveBeenCalledWith({
      where: { operationId: 42 },
      data: {
        status: "REJECTED",
        resolvedAt: expect.any(Date),
      },
    })
    expect(operationSetCompleted).toHaveBeenCalledWith(42)
  })

  test("rejects pending request and completes operation with rejected result", async () => {
    const paymentRequestUpdate = mock(async () => ({}))
    const operationSetCompleted = mock(async () => ({}))
    const prisma = {
      paymentRequest: {
        findUnique: mock(async () => ({ status: "PENDING" })),
        update: paymentRequestUpdate,
      },
    } as unknown as BankPaymentPrisma
    const operationService = {
      setCompleted: operationSetCompleted,
    } as unknown as GenericOperationService<Operation>

    const result = await rejectPaymentRequest(createCrypto(), prisma, operationService, {
      operationId: 42,
    })

    expect(result).toEqual({ status: "REJECTED" })
    expect(paymentRequestUpdate).toHaveBeenCalledWith({
      where: { operationId: 42 },
      data: {
        status: "REJECTED",
        resolvedAt: expect.any(Date),
      },
    })
    expect(operationSetCompleted).toHaveBeenCalledWith(42)
  })

  test("maps rejected operation result without requiring transaction", async () => {
    const prisma = {
      paymentRequest: {
        findUnique: mock(async () => ({ status: "REJECTED", transaction: null })),
      },
    } as unknown as BankPaymentPrisma

    const result = await getPaymentRequestResult(createCrypto(), prisma, 42)

    expect(result).toEqual({ status: "REJECTED" })
  })

  test("lists payment authorizations for payer subject", async () => {
    const prisma = {
      paymentAuthorization: {
        findMany: mock(async () => [
          {
            id: 1,
            requesterSubjectId: "replica:casino",
            createdAt: new Date("2026-07-10T00:00:00.000Z"),
          },
        ]),
      },
    } as unknown as BankPaymentPrisma

    const result = await listPaymentAuthorizations(prisma, "telegram:1")

    expect(result).toEqual([
      {
        id: 1,
        requesterSubjectId: "replica:casino",
        createdAt: "2026-07-10T00:00:00.000Z",
      },
    ])
    expect(prisma.paymentAuthorization.findMany).toHaveBeenCalledWith({
      where: { payerSubjectId: "telegram:1" },
      orderBy: [{ id: "asc" }],
    })
  })

  test("cancels only payer-owned payment authorization", async () => {
    const deleteAuthorization = mock(async () => ({}))
    const prisma = {
      paymentAuthorization: {
        findFirst: mock(async () => ({
          id: 1,
          requesterSubjectId: "replica:casino",
          createdAt: new Date("2026-07-10T00:00:00.000Z"),
        })),
        delete: deleteAuthorization,
      },
    } as unknown as BankPaymentPrisma

    const result = await cancelPaymentAuthorization(prisma, {
      payerSubjectId: "telegram:1",
      authorizationId: 1,
    })

    expect(result?.requesterSubjectId).toBe("replica:casino")
    expect(prisma.paymentAuthorization.findFirst).toHaveBeenCalledWith({
      where: {
        id: 1,
        payerSubjectId: "telegram:1",
      },
    })
    expect(deleteAuthorization).toHaveBeenCalledWith({ where: { id: 1 } })
  })
})

function createCrypto(): ResideCrypto {
  return {
    encrypt: mock(async value => `enc:${value}`),
    decrypt: mock(async (_schema: unknown, ecid: string) => ecid.replace(/^enc:/, "")),
  } as unknown as ResideCrypto
}

function createApprovalPrisma({
  paymentAuthorizationUpsert,
  paymentRequestUpdate,
  payerBalanceEcid = "enc:10",
}: {
  paymentAuthorizationUpsert: ReturnType<typeof mock>
  paymentRequestUpdate: ReturnType<typeof mock>
  payerBalanceEcid?: string
}): BankPaymentPrisma {
  return {
    paymentRequest: {
      findUnique: mock(async () => ({
        status: "PENDING",
        payerSubjectId: "telegram:1",
        requesterSubjectId: "replica:casino",
        amountEcid: "enc:7",
        commentEcid: "enc:Ставка",
        idempotencyKey: "bet:1",
      })),
      update: paymentRequestUpdate,
    },
    paymentAuthorization: {
      upsert: paymentAuthorizationUpsert,
    },
    $transaction: mock(
      async callback =>
        await callback({
          transaction: {
            findUnique: mock(async () => null),
            create: mock(async () => ({
              id: 99n,
              kind: "TRANSFER",
              sender_subject_id: "telegram:1",
              recipient_subject_id: "replica:casino",
              amountEcid: "enc:7",
              commentEcid: "enc:Ставка",
              createdAt: new Date("2026-07-10T00:00:00.000Z"),
            })),
          },
          account: {
            findUnique: mock(async ({ where }: { where: { subject_id: string } }) => ({
              subject_id: where.subject_id,
              balanceEcid: where.subject_id === "telegram:1" ? payerBalanceEcid : "enc:0",
            })),
            update: mock(async () => ({})),
          },
        }),
    ),
  } as unknown as BankPaymentPrisma
}
