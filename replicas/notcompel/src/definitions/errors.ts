import { ResideError } from "@reside/common/definitions"

export class NotcompelError extends ResideError {
  constructor(readonly reason: string) {
    super(reason)
  }
}
