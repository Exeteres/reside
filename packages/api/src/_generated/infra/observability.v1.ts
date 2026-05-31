export * from "./observability.v1_pb"

import type { Client, ServiceImpl } from "@connectrpc/connect"
import { ObservabilityService } from "./observability.v1_pb"

export type ObservabilityServiceClient = Client<typeof ObservabilityService>
export type ObservabilityServiceImplementation = ServiceImpl<typeof ObservabilityService>
