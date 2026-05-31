export * from "./operation.v1_pb"

import type { Client, ServiceImpl } from "@connectrpc/connect"
import { OperationService, OperationSubscriptionService } from "./operation.v1_pb"

export type OperationServiceClient = Client<typeof OperationService>
export type OperationServiceImplementation = ServiceImpl<typeof OperationService>
export type OperationSubscriptionServiceClient = Client<typeof OperationSubscriptionService>
export type OperationSubscriptionServiceImplementation = ServiceImpl<typeof OperationSubscriptionService>
