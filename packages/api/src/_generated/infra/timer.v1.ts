export * from "./timer.v1_pb"

import type { Client, ServiceImpl } from "@connectrpc/connect"
import { TimerService } from "./timer.v1_pb"

export type TimerServiceClient = Client<typeof TimerService>
export type TimerServiceImplementation = ServiceImpl<typeof TimerService>
