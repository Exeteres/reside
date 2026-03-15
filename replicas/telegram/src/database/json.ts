import type { CommandParameter } from "@reside/api/interaction/definition.v1"
import type { Chat, User } from "grammy/types"

declare global {
  namespace PrismaJson {
    type CommandParameters = CommandParameter[]
    type UserData = User
    type ChatData = Chat
  }
}
