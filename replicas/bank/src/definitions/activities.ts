export type GetBalanceInput = {
  /**
   * The RHID of the subject whose balance should be returned.
   */
  subjectRhid: string
}

export type GetBalanceOutput = {
  /**
   * The decrypted balance amount formatted as a decimal string.
   */
  amount: string
}

export type GetTransactionsInput = {
  /**
   * The RHID of the subject whose transaction history should be returned.
   */
  subjectRhid: string
}

export type GetTransactionsOutput = {
  /**
   * The recent transaction lines safe for internal notification delivery.
   */
  lines: string[]
}

export type TransferInput = {
  /**
   * The RHID of the subject sending currency.
   */
  senderSubjectRhid: string

  /**
   * The RHID of the subject receiving currency.
   */
  recipientSubjectRhid: string

  /**
   * The positive integer amount to transfer.
   */
  amount: number

  /**
   * The optional user-provided transfer comment to store encrypted.
   */
  comment?: string
}

export type TransferOutput = {
  /**
   * The transferred amount formatted as a decimal string.
   */
  amount: string
}

export type BankActivities = {
  /**
   * Gets the current encrypted balance for a subject RHID.
   */
  getBalance: (input: GetBalanceInput) => Promise<GetBalanceOutput>

  /**
   * Gets recent transaction history lines for a subject RHID.
   */
  getTransactions: (input: GetTransactionsInput) => Promise<GetTransactionsOutput>

  /**
   * Transfers currency between subject RHIDs and optionally stores an encrypted comment.
   */
  transfer: (input: TransferInput) => Promise<TransferOutput>
}
