import { ResideError } from "@reside/common/definitions"

export class CasinoError extends ResideError {
  constructor(readonly reason: string) {
    super(reason)
  }
}

export class CasinoValidationError extends ResideError {
  constructor(readonly reason: string) {
    super(reason)
  }
}
