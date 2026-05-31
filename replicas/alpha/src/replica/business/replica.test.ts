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
      },
      {
        id: 2,
        name: "telegram",
        title: "Telegram",
        description: "Messenger",
        internalEndpoint: "http://telegram",
        publicEndpoint: "https://telegram.example",
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
        },
        {
          id: 2,
          name: "telegram",
          title: "Telegram",
          description: "Messenger",
          internalEndpoint: "http://telegram",
          publicEndpoint: "https://telegram.example",
        },
      ],
    })
  })
})
