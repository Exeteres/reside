import type { CommandParameter } from "@reside/api/interaction/definition.v1"
import type { NotificationActionRowJson } from "@reside/api/interaction/notification.v1"

declare global {
  namespace PrismaJson {
    type CommandParameters = CommandParameter[]
    type NotificationActionRowsData = NotificationActionRowJson[]
  }
}
