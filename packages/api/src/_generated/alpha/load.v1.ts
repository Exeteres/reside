export * from "./load.v1_pb"

import type { Client, ServiceImpl } from "@connectrpc/connect"
import { LoadService } from "./load.v1_pb"

export type LoadServiceClient = Client<typeof LoadService>
export type LoadServiceImplementation = ServiceImpl<typeof LoadService>
