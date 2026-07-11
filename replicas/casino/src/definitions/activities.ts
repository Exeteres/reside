export type ParsedBet = {
  /**
   * The ECID of the normalized bet amount in ∅.
   */
  amountEcid: string

  /**
   * The selected dice sides, sorted ascending.
   */
  sides: number[]

  /**
   * The number of selected sides.
   */
  selectedSideCount: number

  /**
   * The ECID of the payout amount in ∅.
   */
  payoutAmountEcid: string

  /**
   * The human-readable multiplier label.
   */
  multiplierLabel: string
}

export type BetPaymentStatus = "PENDING" | "APPROVED" | "APPROVED_ALWAYS" | "REJECTED"

export type CasinoActivities = {
  /**
   * Parses and validates the bet command parameters.
   */
  parseBet: (input: { amount: string; rawSides?: string }) => Promise<{ parsed: ParsedBet }>

  /**
   * Verifies that the casino account can cover the win-case payout.
   */
  assertCasinoCanCoverPayout: (input: { payoutAmountEcid: string }) => Promise<void>

  /**
   * Creates or returns the persisted bet for the command invocation.
   */
  createBet: (input: {
    invocationId: string
    workflowId: string
    playerSubjectId: string
    amountEcid: string
    sides: number[]
    payoutAmountEcid: string
  }) => Promise<{ betId: number }>

  /**
   * Stores the notification identifier associated with the bet.
   */
  saveNotification: (input: { betId: number; notificationId: string }) => Promise<void>

  /**
   * Requests payment from the player through the bank replica.
   */
  requestBetPayment: (input: { betId: number }) => Promise<{
    status: BetPaymentStatus
    paymentOperationId?: number
  }>

  /**
   * Marks the bet as waiting for a dice response.
   */
  markWaitingDice: (input: { betId: number }) => Promise<void>

  /**
   * Marks the bet as rejected by the payment flow.
   */
  markPaymentRejected: (input: { betId: number }) => Promise<void>

  /**
   * Marks the bet as lost.
   */
  markLoss: (input: { betId: number; diceEmoji: string; diceValue: number }) => Promise<void>

  /**
   * Marks the bet as waiting for payout transfer.
   */
  markPayoutPending: (input: {
    betId: number
    diceEmoji: string
    diceValue: number
  }) => Promise<void>

  /**
   * Transfers the payout to the player.
   */
  transferPayout: (input: { betId: number }) => Promise<{ transactionId: string }>

  /**
   * Marks the payout as completed.
   */
  completePayout: (input: { betId: number; transactionId: string }) => Promise<void>

  /**
   * Marks the bet as failed with a user-facing failure message.
   */
  failBet: (input: { betId: number; failureMessage: string }) => Promise<void>
}
