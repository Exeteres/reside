export * from "./command.v1_pb"

import type { Client, ServiceImpl } from "@connectrpc/connect"
import { CommandHandlerService } from "./command.v1_pb"

export type CommandHandlerServiceClient = Client<typeof CommandHandlerService>
export type CommandHandlerServiceImplementation = ServiceImpl<typeof CommandHandlerService>
