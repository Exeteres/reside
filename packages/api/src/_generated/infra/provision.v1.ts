export * from "./provision.v1_pb"

import type { Client, ServiceImpl } from "@connectrpc/connect"
import { ProvisionService } from "./provision.v1_pb"

export type ProvisionServiceClient = Client<typeof ProvisionService>
export type ProvisionServiceImplementation = ServiceImpl<typeof ProvisionService>
