import { ResideError } from "@reside/common/definitions"

export class TelegramError extends ResideError {
  constructor(readonly reason: string) {
    super(reason)
  }
}
