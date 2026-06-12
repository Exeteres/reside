export type AccountBalance = {
  subjectId: string
  balance: number
}

export type TransferRecord = {
  id: number
  direction: "incoming" | "outgoing"
  peerSubjectId: string
  amount: number
  createdAt: string
}

export type TransferCurrencyInput = {
  senderSubjectId: string
  recipientHandle: string
  amount: number
}

export type BankActivities = {
  getBalance: (subjectId: string) => Promise<AccountBalance>
  getHistory: (subjectId: string) => Promise<{ records: TransferRecord[] }>
  transferCurrency: (
    input: TransferCurrencyInput,
  ) => Promise<{ sender: AccountBalance; recipient: AccountBalance }>
}
