export * from "./binding.v1_pb"

import type { Client, ServiceImpl } from "@connectrpc/connect"
import { BindingService } from "./binding.v1_pb"

export type BindingServiceClient = Client<typeof BindingService>
export type BindingServiceImplementation = ServiceImpl<typeof BindingService>
