export * from "./registration.v1_pb"

import type { Client, ServiceImpl } from "@connectrpc/connect"
import { RegistrationService } from "./registration.v1_pb"

export type RegistrationServiceClient = Client<typeof RegistrationService>
export type RegistrationServiceImplementation = ServiceImpl<typeof RegistrationService>
