export * from "./definition.v1_pb"

import type { Client, ServiceImpl } from "@connectrpc/connect"
import { DefinitionService } from "./definition.v1_pb"

export type DefinitionServiceClient = Client<typeof DefinitionService>
export type DefinitionServiceImplementation = ServiceImpl<typeof DefinitionService>
