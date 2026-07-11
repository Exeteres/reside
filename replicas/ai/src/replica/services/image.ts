import type { CommandHandlerServiceImplementation } from "@reside/api/interaction/command.v1"
import type { NotificationServiceClient } from "@reside/api/interaction/notification.v1"
import type { StorageBucketService } from "@reside/common"
import type { ResideCrypto } from "@reside/common/encryption"
import type OpenAI from "openai"
import type { GenerateImage } from "../business"
import { create } from "@bufbuild/protobuf"
import { Code, ConnectError } from "@connectrpc/connect"
import { SendNotificationRequestSchema } from "@reside/api/interaction/notification.v1"
import { authenticateReplica } from "@reside/common"
import { z } from "zod"
import { AiNotificationChannels } from "../../definitions"
import { strings } from "../../locale"
import { createAiImage } from "../business"

const llmSecretSchema = z.object({
  endpoint: z.string().trim().min(1),
  "api-key": z.string().trim().min(1),
  "image-model": z.string().trim().min(1),
  "smart-model": z.string().trim().min(1).optional(),
})

type OpenAiConstructor = new (options: { apiKey: string; baseURL: string }) => OpenAI

export function createImageCommandService({
  storage,
  notificationService,
  generateImage,
}: {
  storage: StorageBucketService
  notificationService: NotificationServiceClient
  generateImage: GenerateImage
}): CommandHandlerServiceImplementation {
  return {
    async invokeCommand(request, context) {
      await authenticateReplica(context)

      const size = getStringParameter(request.parameters, "size")
      const prompt = getStringParameter(request.parameters, "prompt")
      if (size === undefined || prompt === undefined) {
        throw new ConnectError(
          "Image command requires size and prompt parameters",
          Code.InvalidArgument,
        )
      }

      const image = await createAiImage(generateImage, storage, { size, prompt })

      await notificationService.sendNotification(
        create(SendNotificationRequestSchema, {
          contextToken: request.context?.token,
          channel: AiNotificationChannels.COMMAND,
          title: strings.notifications.ai.success.title,
          imageUrls: [image.url],
        }),
      )

      return {}
    },
  }
}

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

function getStringParameter(parameters: unknown, name: string): string | undefined {
  if (typeof parameters !== "object" || parameters === null) {
    return undefined
  }

  const value = (parameters as Record<string, unknown>)[name]
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}
