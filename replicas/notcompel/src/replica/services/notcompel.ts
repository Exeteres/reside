import type { NotcompelServiceImplementation } from "@reside/api/notcompel/notcompel.v1"
import type { NotcompelServices } from "../../shared"
import { Code, ConnectError } from "@connectrpc/connect"
import { NotcompelNotificationChannels } from "../../definitions"
import { strings } from "../../locale"
import { fetchNotcompelImage } from "../business"

type NotcompelServiceDependencies = Pick<NotcompelServices, "notificationService">

export function createNotcompelService({
  notificationService,
}: NotcompelServiceDependencies): NotcompelServiceImplementation {
  return {
    async sendImage() {
      try {
        const image = await fetchNotcompelImage()
        const notification = await notificationService.sendNotification({
          channel: NotcompelNotificationChannels.IMAGE,
          title: strings.notifications.notcompel.success.title,
          images: [
            {
              name: image.name,
              content: image.content,
            },
          ],
        })

        return {
          notificationId: notification.notificationId,
          messageLink: notification.messageLink,
        }
      } catch (error) {
        throw new ConnectError(
          "Failed to send Notcompel image",
          Code.Internal,
          undefined,
          undefined,
          error,
        )
      }
    },
  }
}
