export * from "./subject.v1_pb"

import type { Client, ServiceImpl } from "@connectrpc/connect"
import { SubjectService } from "./subject.v1_pb"

export type SubjectServiceClient = Client<typeof SubjectService>
export type SubjectServiceImplementation = ServiceImpl<typeof SubjectService>
