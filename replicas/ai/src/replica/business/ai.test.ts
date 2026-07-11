import type { StorageBucketService } from "@reside/common"
import { describe, expect, it } from "bun:test"
import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3"
import { mockDeepFn } from "@reside/common/testing"
import { createAiImage, getAiStatus } from "./ai"

describe("createAiImage", () => {
  it("generates an image, uploads it to S3, and returns a presigned URL", async () => {
    const client = mockDeepFn<S3Client>()
    const storage: StorageBucketService = {
      bucket: "ai-bucket",
      client,
    }

    const result = await createAiImage(
      async () => ({
        bytes: new Uint8Array([1, 2, 3]),
        contentType: "image/png",
      }),
      storage,
      {
        size: "1024x1024",
        prompt: "a silent wizard",
      },
      async objectKey => `https://storage.example/${objectKey}`,
    )

    expect(result.objectKey).toStartWith("images/")
    expect(result.url).toBe(`https://storage.example/${result.objectKey}`)
    expect(client.send.spy().mock.calls[0]?.[0]).toBeInstanceOf(PutObjectCommand)
  })

  it("rejects empty prompts", () => {
    const client = mockDeepFn<S3Client>()
    const storage: StorageBucketService = {
      bucket: "ai-bucket",
      client,
    }

    expect(
      createAiImage(
        async () => ({
          bytes: new Uint8Array([1]),
          contentType: "image/png",
        }),
        storage,
        {
          size: "1024x1024",
          prompt: " ",
        },
      ),
    ).rejects.toThrow("Image prompt must not be empty")
  })
})

describe("getAiStatus", () => {
  it("returns storage status", () => {
    const status = getAiStatus({ bucket: "ai-bucket" })

    expect(status).toEqual({
      storageConfigured: true,
    })
  })
})
