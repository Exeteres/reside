import { ResideError } from "@reside/common/definitions"

export class HelloError extends ResideError {
  constructor(readonly reason: string) {
    super(reason)
  }
}
