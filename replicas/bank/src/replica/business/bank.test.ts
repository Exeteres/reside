import type { ResideCrypto } from "@reside/common"
import type { BankPrisma } from "./bank"
import { describe, expect, test } from "bun:test"
import { transfer } from "./bank"

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
})
