import type { PrismaClient } from "../../database"
import { describe, expect, test } from "bun:test"
import { mockDeepFn, testCrypto } from "@reside/common/testing"
import { replaceUserReferencesWithSubjectIds } from "./user-reference"

process.env.REPLICA_NAME = "telegram"

describe("replaceUserReferencesWithSubjectIds", () => {
  test("replaces isolated at-mentions, usernames, and telegram user ids", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const aliceUsernameEcid = await testCrypto.encrypt("alice_user")
    const bobUsernameEcid = await testCrypto.encrypt("bob_user")

    prisma.user.findUnique.mockResolvedValue({ id: 30 } as never)
    prisma.user.findMany.mockResolvedValue([
      { id: 10, usernameEcid: aliceUsernameEcid },
      { id: 20, usernameEcid: bobUsernameEcid },
    ] as never)

    const result = await replaceUserReferencesWithSubjectIds({
      crypto: testCrypto,
      prisma,
      text: "ask @alice_user bob_user 123456",
    })

    expect(result).toBe("ask telegram:10 telegram:20 telegram:30")
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
