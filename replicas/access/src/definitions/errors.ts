import { ResideError } from "@reside/common/definitions"

export class AccessError extends ResideError {
  constructor(readonly reason: string) {
    super(reason)
  }
}
