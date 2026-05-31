export * from "./notification.v1_pb"

import type { Client, ServiceImpl } from "@connectrpc/connect"
import { NotificationService } from "./notification.v1_pb"

export type NotificationServiceClient = Client<typeof NotificationService>
export type NotificationServiceImplementation = ServiceImpl<typeof NotificationService>
