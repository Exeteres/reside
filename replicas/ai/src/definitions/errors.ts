import { ResideError } from "@reside/common/definitions"

export class AiError extends ResideError {
  constructor(readonly reason: string) {
    super(reason)
  }
}
