import type { ResideCrypto, StorageBucketService } from "@reside/common"
import type { PrismaClient } from "../../database"
import { describe, expect, it } from "bun:test"
import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3"
import { mockDeepFn } from "@reside/common/testing"
import { createExampleNote, getExampleStatus } from "./example"

describe("createExampleNote", () => {
  it("encrypts content, uploads S3 object, and stores metadata", async () => {
    const crypto = mockDeepFn<ResideCrypto>()
    const prisma = mockDeepFn<PrismaClient>()
    const client = mockDeepFn<S3Client>()
    const storage: StorageBucketService = {
      bucket: "example-bucket",
      client,
    }

    crypto.encrypt.mockResolvedValue("enc:example:test")
    prisma.exampleNote.create.mockResolvedValue({
      id: "note_1",
      title: "Demo",
      source: "test",
      contentEcid: "enc:example:test",
      objectKey: "examples/note_1.json",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    })

    const result = await createExampleNote(crypto, prisma, storage, {
      title: "Demo",
      content: "private content",
      source: "test",
    })

    expect(result.noteId).toBe("note_1")
    expect(result.objectKey).toStartWith("examples/")
    expect(crypto.encrypt.spy()).toHaveBeenCalledWith({ content: "private content" })
    expect(client.send.spy().mock.calls[0]?.[0]).toBeInstanceOf(PutObjectCommand)
    expect(prisma.exampleNote.create.spy()).toHaveBeenCalledWith({
      data: {
        title: "Demo",
        source: "test",
        contentEcid: "enc:example:test",
        objectKey: result.objectKey,
      },
      select: {
        id: true,
      },
    })
  })
})

describe("getExampleStatus", () => {
  it("returns note count and storage status", async () => {
    const prisma = mockDeepFn<PrismaClient>()

    prisma.exampleNote.count.mockResolvedValue(3)

    const status = await getExampleStatus(prisma, { bucket: "example-bucket" })

    expect(status).toEqual({
      noteCount: 3,
      storageConfigured: true,
    })
  })
})
