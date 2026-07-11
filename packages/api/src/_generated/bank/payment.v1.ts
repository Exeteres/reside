export * from "./payment.v1_pb"

import type { Client, ServiceImpl } from "@connectrpc/connect"
import { BankPaymentService } from "./payment.v1_pb"

export type BankPaymentServiceClient = Client<typeof BankPaymentService>
export type BankPaymentServiceImplementation = ServiceImpl<typeof BankPaymentService>
