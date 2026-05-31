import { ResideError } from "@reside/common/definitions"

export class CommitValidationError extends ResideError {
  constructor(readonly reason: string) {
    super(reason)
  }
}
