export * from "./replica.v1_pb"

import type { Client, ServiceImpl } from "@connectrpc/connect"
import { ReplicaService } from "./replica.v1_pb"

export type ReplicaServiceClient = Client<typeof ReplicaService>
export type ReplicaServiceImplementation = ServiceImpl<typeof ReplicaService>
