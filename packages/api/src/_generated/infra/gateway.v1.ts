export * from "./gateway.v1_pb"

import type { Client, ServiceImpl } from "@connectrpc/connect"
import { GatewayService } from "./gateway.v1_pb"

export type GatewayServiceClient = Client<typeof GatewayService>
export type GatewayServiceImplementation = ServiceImpl<typeof GatewayService>
