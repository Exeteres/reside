import type { PrismaClient } from "../../database"
import { describe, expect, test } from "bun:test"
import { mockDeepFn } from "@reside/common/testing"
import { listReplicaInfos } from "./replica"

describe("listReplicaInfos", () => {
  test("queries replicas sorted by name and maps nullable fields", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    prisma.replica.findMany.mockResolvedValue([
      {
        id: 1,
        name: "alpha",
        title: "Alpha",
        description: null,
        internalEndpoint: "http://alpha",
        publicEndpoint: null,
        version: null,
        changes: null,
      },
      {
        id: 2,
        name: "telegram",
        title: "Telegram",
        description: "Messenger",
        internalEndpoint: "http://telegram",
        publicEndpoint: "https://telegram.example",
        version: "1.2.3",
        changes: "- Added release notes",
      },
    ] as never)

    const result = await listReplicaInfos(prisma)

    expect(prisma.replica.findMany.spy()).toHaveBeenCalledWith({
      select: {
        id: true,
        name: true,
        title: true,
        description: true,
        internalEndpoint: true,
        publicEndpoint: true,
        version: true,
        changes: true,
      },
      orderBy: [{ name: "asc" }],
    })
    expect(result).toEqual({
      replicas: [
        {
          id: 1,
          name: "alpha",
          title: "Alpha",
          description: undefined,
          internalEndpoint: "http://alpha",
          publicEndpoint: undefined,
          version: undefined,
          changes: undefined,
        },
        {
          id: 2,
          name: "telegram",
          title: "Telegram",
          description: "Messenger",
          internalEndpoint: "http://telegram",
          publicEndpoint: "https://telegram.example",
          version: "1.2.3",
          changes: "- Added release notes",
        },
      ],
    })
  })
})
