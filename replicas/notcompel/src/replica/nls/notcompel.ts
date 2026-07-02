import type { NotcompelServices } from "../../shared"
import { create } from "@bufbuild/protobuf"
import { defineTool } from "@github/copilot-sdk"
import { SendImageRequestSchema } from "@reside/api/notcompel/notcompel.v1"
import { z } from "zod"
import { createNotcompelService } from "../services"

type NotcompelToolServices = Pick<NotcompelServices, "notificationService">

export function createNotcompelTools(services: NotcompelToolServices) {
  const notcompelService = createNotcompelService(services)

  return [
    defineTool("send_notcompel_image", {
      description: "Fetches the current image from notcompel.ru and sends it to the system chat.",
      parameters: z.object({}),
      handler: async () => {
        const result = await notcompelService.sendImage(
          create(SendImageRequestSchema),
          undefined as never,
        )

        return {
          ...result,
          response: "The Notcompel image was sent to the system chat.",
        }
      },
    }),
  ]
}
