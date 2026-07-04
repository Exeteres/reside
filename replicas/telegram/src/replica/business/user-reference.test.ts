import type { PrismaClient } from "../../database"
import { describe, expect, test } from "bun:test"
import { mockDeepFn, testCrypto } from "@reside/common/testing"
import { replaceUserReferencesWithSubjectIds } from "./user-reference"

process.env.REPLICA_NAME = "telegram"

describe("replaceUserReferencesWithSubjectIds", () => {
  test("replaces isolated at-mentions, usernames, and telegram user ids", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const aliceDataEcid = await testCrypto.encrypt({ username: "alice_user" })
    const bobDataEcid = await testCrypto.encrypt({ username: "bob_user" })

    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 30 } as never)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValue(null as never)
    prisma.user.findMany.mockResolvedValue([
      { id: 10, dataEcid: aliceDataEcid },
      { id: 20, dataEcid: bobDataEcid },
    ] as never)

    const result = await replaceUserReferencesWithSubjectIds({
      crypto: testCrypto,
      prisma,
      text: "ask @alice_user bob_user 123456",
    })

    expect(result).toBe("ask telegram:10 telegram:20 telegram:30")
  })

  test("uses username rhid lookup before decrypting existing user data", async () => {
    const prisma = mockDeepFn<PrismaClient>()

    prisma.user.findUnique.mockResolvedValue({ id: 10 } as never)

    const result = await replaceUserReferencesWithSubjectIds({
      crypto: testCrypto,
      prisma,
      text: "ask @alice_user",
    })

    expect(result).toBe("ask telegram:10")
    expect(prisma.user.findMany.spy()).toHaveBeenCalledTimes(0)
  })

  test("does not replace references embedded into other text", async () => {
    const prisma = mockDeepFn<PrismaClient>()

    const result = await replaceUserReferencesWithSubjectIds({
      crypto: testCrypto,
      prisma,
      text: "hello,@alice_user and id=123456",
    })

    expect(result).toBe("hello,@alice_user and id=123456")
    expect(prisma.user.findUnique.spy()).toHaveBeenCalledTimes(0)
    expect(prisma.user.findMany.spy()).toHaveBeenCalledTimes(0)
  })
})
