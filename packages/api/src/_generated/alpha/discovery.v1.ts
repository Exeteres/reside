export * from "./discovery.v1_pb"

import type { Client, ServiceImpl } from "@connectrpc/connect"
import { DiscoveryService } from "./discovery.v1_pb"

export type DiscoveryServiceClient = Client<typeof DiscoveryService>
export type DiscoveryServiceImplementation = ServiceImpl<typeof DiscoveryService>
