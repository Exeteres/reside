export * from "./approval.v1_pb"

import type { Client, ServiceImpl } from "@connectrpc/connect"
import { ApprovalService } from "./approval.v1_pb"

export type ApprovalServiceClient = Client<typeof ApprovalService>
export type ApprovalServiceImplementation = ServiceImpl<typeof ApprovalService>
