import type { AiActivities } from "../../definitions"
import type { AiServices } from "../../shared"
import { crypto } from "@reside/common"
import OpenAI from "openai"
import { createAiImage } from "../business"
import { createOpenAiImageGenerator } from "../services"

type AiActivityServices = Pick<AiServices, "storage">

export function createAiActivities({ storage }: AiActivityServices): AiActivities {
  const generateImage = createOpenAiImageGenerator(OpenAI, crypto)

  return {
    async createAiImage(input) {
      const image = await createAiImage(generateImage, storage, input)

      return {
        url: image.url,
      }
    },
  }
}
