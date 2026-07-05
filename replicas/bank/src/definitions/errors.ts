import { ResideError } from "@reside/common/definitions"

export class BankError extends ResideError {
  constructor(readonly reason: string) {
    super(reason)
  }
}
