import { ResideError } from "@reside/common/definitions"

export class ExampleError extends ResideError {
  constructor(readonly reason: string) {
    super(reason)
  }
}
