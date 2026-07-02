export * from "./notcompel.v1_pb"

import type { Client, ServiceImpl } from "@connectrpc/connect"
import { NotcompelService } from "./notcompel.v1_pb"

export type NotcompelServiceClient = Client<typeof NotcompelService>
export type NotcompelServiceImplementation = ServiceImpl<typeof NotcompelService>
