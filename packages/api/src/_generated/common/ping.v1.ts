export * from "./ping.v1_pb"

import type { Client, ServiceImpl } from "@connectrpc/connect"
import { PingService } from "./ping.v1_pb"

export type PingServiceClient = Client<typeof PingService>
export type PingServiceImplementation = ServiceImpl<typeof PingService>
