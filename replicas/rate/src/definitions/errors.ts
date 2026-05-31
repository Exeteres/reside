import { ResideError } from "@reside/common/definitions"

export class RateError extends ResideError {
  constructor(readonly reason: string) {
    super(reason)
  }
}
