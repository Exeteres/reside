import type { ResideCrypto } from "@reside/common/encryption"
import type { PrismaClient } from "../../database"
import { describe, expect, it } from "bun:test"
import { mockDeepFn } from "@reside/common/testing"
import {
  InsufficientFundsError,
  InvalidTransferAmountError,
  InvalidTransferRecipientError,
} from "../../definitions"
import { getBalance, getTransactions, transferAmount } from "./bank"

function createCrypto(values: Record<string, { amount: string }> = {}): ResideCrypto {
  return {
    async encrypt(data: unknown) {
      const amount = (data as { amount: string }).amount
      return `ecid:${amount}`
    },
    async decrypt(schema, ecid) {
      if (Array.isArray(ecid)) return schema.parse(ecid.map(current => values[current]))
      return schema.parse(values[ecid] ?? { amount: ecid.replace("ecid:", "") })
    },
    async getSecret(schema, name) {
      return schema.parse({ value: `test-secret:${name}` })
    },
  }
}

describe("getBalance", () => {
  it("creates an encrypted initial-balance account when it is missing", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const crypto = createCrypto()

    prisma.account.upsert.mockResolvedValue({ id: "account_1", balanceEcid: "ecid:100" } as never)

    await expect(getBalance(crypto, prisma, "subject_rhid")).resolves.toBe("100")
    expect(prisma.account.upsert.spy()).toHaveBeenCalledWith({
      where: { subjectRhid: "subject_rhid" },
      create: { subjectRhid: "subject_rhid", balanceEcid: "ecid:100" },
      update: {},
      select: { id: true, balanceEcid: true },
    })
  })
})

describe("getTransactions", () => {
  it("returns decrypted signed transaction lines", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const crypto = createCrypto({ "ecid:5": { amount: "5" } })

    prisma.account.upsert.mockResolvedValue({
      id: "account_1",
      balanceEcid: "ecid:10",
    } as never)
    prisma.transaction.findMany.mockResolvedValue([
      {
        senderAccount: { subjectRhid: "sender_rhid" },
        recipientAccountId: "account_1",
        amountEcid: "ecid:5",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ] as never)

    await expect(getTransactions(crypto, prisma, "subject_rhid")).resolves.toEqual([
      "2026-01-01T00:00:00.000Z +5 ∅, отправитель: sender_rhid",
    ])
  })
})

describe("transferAmount", () => {
  it("moves encrypted funds and records encrypted transaction amount", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const crypto = createCrypto({ "ecid:10": { amount: "10" }, "ecid:1": { amount: "1" } })
    const tx = mockDeepFn<PrismaClient>()

    prisma.$transaction.mockImplementation(async callback => callback(tx))
    tx.account.upsert.mockResolvedValueOnce({ id: "sender", balanceEcid: "stale" } as never)
    tx.account.upsert.mockResolvedValueOnce({ id: "recipient", balanceEcid: "stale" } as never)
    tx.account.findUniqueOrThrow.mockResolvedValueOnce({
      id: "sender",
      balanceEcid: "ecid:10",
    } as never)
    tx.account.findUniqueOrThrow.mockResolvedValueOnce({
      id: "recipient",
      balanceEcid: "ecid:1",
    } as never)
    tx.$executeRaw.mockResolvedValue(2 as never)

    await expect(transferAmount(crypto, prisma, "sender_rhid", "recipient_rhid", 3)).resolves.toBe(
      "3",
    )
    expect(tx.$executeRaw.spy()).toHaveBeenCalledTimes(1)
    expect(tx.account.update.spy()).toHaveBeenCalledWith({
      where: { id: "sender" },
      data: { balanceEcid: "ecid:7" },
    })
    expect(tx.account.update.spy()).toHaveBeenCalledWith({
      where: { id: "recipient" },
      data: { balanceEcid: "ecid:4" },
    })
    expect(tx.transaction.create.spy()).toHaveBeenCalledWith({
      data: { senderAccountId: "sender", recipientAccountId: "recipient", amountEcid: "ecid:3" },
    })
  })

  it("rejects transfers that exceed the encrypted balance", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const crypto = createCrypto({ "ecid:1": { amount: "1" } })
    const tx = mockDeepFn<PrismaClient>()

    prisma.$transaction.mockImplementation(async callback => callback(tx))
    tx.account.upsert.mockResolvedValueOnce({ id: "sender", balanceEcid: "stale" } as never)
    tx.account.upsert.mockResolvedValueOnce({ id: "recipient", balanceEcid: "stale" } as never)
    tx.account.findUniqueOrThrow.mockResolvedValueOnce({
      id: "sender",
      balanceEcid: "ecid:1",
    } as never)
    tx.account.findUniqueOrThrow.mockResolvedValueOnce({
      id: "recipient",
      balanceEcid: "ecid:0",
    } as never)
    tx.$executeRaw.mockResolvedValue(2 as never)

    await expect(
      transferAmount(crypto, prisma, "sender_rhid", "recipient_rhid", 3),
    ).rejects.toBeInstanceOf(InsufficientFundsError)
  })

  it("rejects invalid transfer amounts with a domain error", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const crypto = createCrypto()

    await expect(
      transferAmount(crypto, prisma, "sender_rhid", "recipient_rhid", 0),
    ).rejects.toBeInstanceOf(InvalidTransferAmountError)
  })

  it("rejects transfers to the same account", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const crypto = createCrypto()

    await expect(
      transferAmount(crypto, prisma, "sender_rhid", "sender_rhid", 1),
    ).rejects.toBeInstanceOf(InvalidTransferRecipientError)
  })
})
