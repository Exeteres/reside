export * from "./authz.v1_pb"

import type { Client, ServiceImpl } from "@connectrpc/connect"
import { AuthzService } from "./authz.v1_pb"

export type AuthzServiceClient = Client<typeof AuthzService>
export type AuthzServiceImplementation = ServiceImpl<typeof AuthzService>
