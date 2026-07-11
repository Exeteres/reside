import type { ResideCrypto } from "@reside/common/encryption"
import type OpenAI from "openai"
import type { GenerateImage } from "../business"
import { z } from "zod"

const llmSecretSchema = z.object({
  endpoint: z.string().trim().min(1),
  "api-key": z.string().trim().min(1),
  "image-model": z.string().trim().min(1),
  "image-moderation": z.enum(["low", "auto"]).default("auto"),
  "smart-model": z.string().trim().min(1).optional(),
})

type OpenAiConstructor = new (options: { apiKey: string; baseURL: string }) => OpenAI

export function createOpenAiImageGenerator(
  OpenAiClient: OpenAiConstructor,
  crypto: Pick<ResideCrypto, "getSecret">,
): GenerateImage {
  return async ({ prompt, size }) => {
    const llmSecret = await crypto.getSecret(llmSecretSchema, "llm")
    const client = new OpenAiClient({
      apiKey: llmSecret["api-key"],
      baseURL: llmSecret.endpoint,
    })

    const response = await client.images.generate({
      model: llmSecret["image-model"],
      moderation: llmSecret["image-moderation"],
      prompt,
      size,
      response_format: "b64_json",
    })

    const encodedImage = response.data?.[0]?.b64_json
    if (encodedImage === undefined || encodedImage.length === 0) {
      throw new Error("OpenAI image response is empty")
    }

    return {
      bytes: Buffer.from(encodedImage, "base64"),
      contentType: "image/png",
    }
  }
}
