export * from "./request.v1_pb"

import type { Client, ServiceImpl } from "@connectrpc/connect"
import { PermissionRequestService } from "./request.v1_pb"

export type PermissionRequestServiceClient = Client<typeof PermissionRequestService>
export type PermissionRequestServiceImplementation = ServiceImpl<typeof PermissionRequestService>
