import type { ResideCrypto } from "@reside/common/encryption"
import type OpenAI from "openai"
import { describe, expect, test } from "bun:test"
import { createOpenAiImageGenerator } from "./image"

type OpenAiConstructor = new (options: { apiKey: string; baseURL: string }) => OpenAI

type ImageGenerateRequest = {
  model: string
  moderation: "low" | "auto"
  prompt: string
  response_format: "b64_json"
  size: string
}

class FakeOpenAiClient {
  static requests: ImageGenerateRequest[] = []

  readonly images = {
    generate: async (request: ImageGenerateRequest) => {
      FakeOpenAiClient.requests.push(request)

      return {
        data: [
          {
            b64_json: Buffer.from([1, 2, 3]).toString("base64"),
          },
        ],
      }
    },
  }
}

function createCrypto(secret: Record<string, unknown>): Pick<ResideCrypto, "getSecret"> {
  return {
    getSecret: (async schema => schema.parse(secret)) as ResideCrypto["getSecret"],
  }
}

describe("createOpenAiImageGenerator", () => {
  test("uses auto moderation by default", async () => {
    FakeOpenAiClient.requests = []

    const generateImage = createOpenAiImageGenerator(
      FakeOpenAiClient as unknown as OpenAiConstructor,
      createCrypto({
        endpoint: "https://api.openai.example/v1",
        "api-key": "secret-key",
        "image-model": "gpt-image-1",
      }),
    )

    await generateImage({
      prompt: "a silent wizard",
      size: "1024x1024",
    })

    expect(FakeOpenAiClient.requests[0]?.moderation).toBe("auto")
  })

  test("passes configured moderation", async () => {
    FakeOpenAiClient.requests = []

    const generateImage = createOpenAiImageGenerator(
      FakeOpenAiClient as unknown as OpenAiConstructor,
      createCrypto({
        endpoint: "https://api.openai.example/v1",
        "api-key": "secret-key",
        "image-model": "gpt-image-1",
        "image-moderation": "low",
      }),
    )

    await generateImage({
      prompt: "a silent wizard",
      size: "1024x1024",
    })

    expect(FakeOpenAiClient.requests[0]?.moderation).toBe("low")
  })
})
