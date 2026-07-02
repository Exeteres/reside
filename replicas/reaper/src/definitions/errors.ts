import { ResideError } from "@reside/common/definitions"

export class ReaperError extends ResideError {
  constructor(readonly reason: string) {
    super(reason)
  }
}
