export * from "./topic.v1_pb"

import type { Client, ServiceImpl } from "@connectrpc/connect"
import { TopicService } from "./topic.v1_pb"

export type TopicServiceClient = Client<typeof TopicService>
export type TopicServiceImplementation = ServiceImpl<typeof TopicService>
