import type { NotcompelActivities } from "../../definitions"
import type { NotcompelServices } from "../../shared"
import { create } from "@bufbuild/protobuf"
import { SendImageRequestSchema } from "@reside/api/notcompel/notcompel.v1"
import { createNotcompelService } from "../services"

type NotcompelActivityServices = Pick<NotcompelServices, "notificationService">

export function createNotcompelActivities(
  services: NotcompelActivityServices,
): NotcompelActivities {
  const notcompelService = createNotcompelService(services)

  return {
    async sendNotcompelImage() {
      const result = await notcompelService.sendImage(
        create(SendImageRequestSchema),
        undefined as never,
      )

      return {
        notificationId: result.notificationId ?? "",
        messageLink: result.messageLink,
      }
    },
  }
}
