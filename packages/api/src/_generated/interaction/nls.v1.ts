export * from "./nls.v1_pb"

import type { Client, ServiceImpl } from "@connectrpc/connect"
import { NaturalLanguageService } from "./nls.v1_pb"

export type NaturalLanguageServiceClient = Client<typeof NaturalLanguageService>
export type NaturalLanguageServiceImplementation = ServiceImpl<typeof NaturalLanguageService>
