import { ResideError } from "@reside/common/definitions"

export class InvalidTransferAmountError extends ResideError {
  constructor(readonly amount: number) {
    super(`Invalid transfer amount "${amount}"`)
  }
}

export class InsufficientFundsError extends ResideError {
  constructor(
    readonly balance: bigint,
    readonly amount: bigint,
  ) {
    super(`Insufficient funds for transfer "${amount}" from balance "${balance}"`)
  }
}

export class InvalidTransferRecipientError extends ResideError {
  constructor(readonly subjectRhid: string) {
    super(`Invalid transfer recipient "${subjectRhid}"`)
  }
}
