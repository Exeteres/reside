export * from "./vault.v1_pb"

import type { Client, ServiceImpl } from "@connectrpc/connect"
import { VaultService } from "./vault.v1_pb"

export type VaultServiceClient = Client<typeof VaultService>
export type VaultServiceImplementation = ServiceImpl<typeof VaultService>
