import type { ResideCrypto } from "@reside/common"
import type { BankPrisma } from "./bank"
import { describe, expect, test } from "bun:test"
import { listTransactionAmountReferences, transfer } from "./bank"

const crypto = {} as ResideCrypto
const prisma = {} as BankPrisma

describe("bank ledger", () => {
  test("rejects non-positive transfer amounts", () => {
    expect(
      transfer(crypto, prisma, {
        senderSubjectId: "telegram:1",
        recipientSubjectId: "telegram:2",
        amount: "0",
        idempotencyKey: "test:zero",
      }),
    ).rejects.toThrow("Сумма должна быть положительной")
  })

  test("rejects self transfers", () => {
    expect(
      transfer(crypto, prisma, {
        senderSubjectId: "telegram:1",
        recipientSubjectId: "telegram:1",
        amount: "1",
        idempotencyKey: "test:self",
      }),
    ).rejects.toThrow("Отправитель и получатель должны отличаться")
  })

  test("lists transaction amount ecids without decrypting amounts", async () => {
    const decryptCalls: string[] = []
    const listCrypto = {
      encrypt: async () => "enc:bank:balance",
      decrypt: async (_schema: unknown, ecid: string | string[]) => {
        if (typeof ecid === "string") {
          decryptCalls.push(ecid)
        }

        return "100"
      },
    } as unknown as ResideCrypto
    const listPrisma = {
      account: {
        findUnique: async () => ({ subject_id: "telegram:1", balanceEcid: "enc:bank:balance" }),
      },
      transaction: {
        findMany: async () => [
          {
            id: 7n,
            kind: "TRANSFER",
            sender_subject_id: "telegram:2",
            recipient_subject_id: "telegram:1",
            amountEcid: "enc:bank:amount",
            commentEcid: null,
            createdAt: new Date("2026-07-05T00:00:00.000Z"),
          },
        ],
      },
    } as unknown as BankPrisma

    const result = await listTransactionAmountReferences(listCrypto, listPrisma, {
      subjectId: "telegram:1",
    })

    expect(result.transactions[0]?.amountEcid).toBe("enc:bank:amount")
    expect(result.transactions[0]).not.toHaveProperty("amount")
    expect(decryptCalls).toEqual([])
  })
})
