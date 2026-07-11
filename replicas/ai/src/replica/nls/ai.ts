import type { AiServices } from "../../shared"
import type { GenerateImage } from "../business"
import { crypto, defineTool } from "@reside/common"
import OpenAI from "openai"
import { z } from "zod"
import { createAiImage, getAiStatus } from "../business"
import { createOpenAiImageGenerator } from "../services"

type AiToolServices = Pick<AiServices, "storage">

export function createAiTools({ storage }: AiToolServices, generateImage?: GenerateImage) {
  const imageGenerator = generateImage ?? createOpenAiImageGenerator(OpenAI, crypto)

  return [
    defineTool("get_ai_status", {
      description: "Gets non-sensitive AI replica status and storage configuration.",
      parameters: z.object({}),
      handler: async () => {
        const status = getAiStatus(storage)

        return {
          ...status,
          response: `AI replica storage is ${status.storageConfigured ? "configured" : "not configured"}.`,
        }
      },
    }),
    defineTool("create_image", {
      description: "Creates an image from a text prompt and returns a presigned image URL.",
      parameters: z.object({
        size: z.string().trim().min(1).describe("Image size, for example 1024x1024."),
        prompt: z.string().trim().min(1).describe("Text prompt for the generated image."),
      }),
      handler: async ({ size, prompt }) => {
        const image = await createAiImage(imageGenerator, storage, { size, prompt })

        return {
          imageUrl: image.url,
          response: "Image created.",
        }
      },
    }),
  ]
}
