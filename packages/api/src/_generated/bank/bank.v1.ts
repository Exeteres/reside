export * from "./bank.v1_pb"

import type { Client, ServiceImpl } from "@connectrpc/connect"
import { BankService } from "./bank.v1_pb"

export type BankServiceClient = Client<typeof BankService>
export type BankServiceImplementation = ServiceImpl<typeof BankService>
