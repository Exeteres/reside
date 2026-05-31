export * from "./avatar.v1_pb"

import type { Client, ServiceImpl } from "@connectrpc/connect"
import { AvatarService } from "./avatar.v1_pb"

export type AvatarServiceClient = Client<typeof AvatarService>
export type AvatarServiceImplementation = ServiceImpl<typeof AvatarService>
