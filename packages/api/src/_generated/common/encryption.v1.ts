export * from "./encryption.v1_pb"

import type { Client, ServiceImpl } from "@connectrpc/connect"
import { EncryptionService } from "./encryption.v1_pb"

export type EncryptionServiceClient = Client<typeof EncryptionService>
export type EncryptionServiceImplementation = ServiceImpl<typeof EncryptionService>
