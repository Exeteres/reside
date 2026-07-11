export type BankTransaction = {
  id: string
  kind: "ISSUE" | "TRANSFER"
  senderSubjectId?: string
  recipientSubjectId: string
  amount: string
  comment?: string
  createdAt: string
}

export type PaymentRequestResultStatus = "APPROVED" | "APPROVED_ALWAYS" | "REJECTED"

export type PaymentRequestResult = {
  status: PaymentRequestResultStatus
  transaction?: BankTransaction
}

export type BankActivities = {
  getBalance: (input: { subjectId: string }) => Promise<{ balance: string }>
  listTransactions: (input: {
    subjectId: string
    pageSize: number
    pageToken?: string
  }) => Promise<{ transactions: BankTransaction[]; nextPageToken?: string }>
  transfer: (input: {
    senderSubjectId: string
    recipientSubjectId: string
    amount: string
    idempotencyKey: string
  }) => Promise<{ transaction: BankTransaction }>
  issueReplicaFunds: (input: {
    callerSubjectId: string
    replicaName: string
    amount: string
    idempotencyKey: string
  }) => Promise<{ transaction: BankTransaction }>
  fundTelegramAccount: (input: { subjectId: string }) => Promise<{ transaction: BankTransaction }>
  getPendingPaymentRequest: (input: { operationId: number }) => Promise<{
    payerSubjectId: string
    requesterSubjectId: string
    amount: string
    commentEcid?: string
  }>
  approvePaymentRequest: (input: {
    operationId: number
    approveAlways: boolean
  }) => Promise<{ result: PaymentRequestResult }>
  rejectPaymentRequest: (input: {
    operationId: number
  }) => Promise<{ result: PaymentRequestResult }>
  failPaymentRequest: (input: { operationId: number; failureMessage: string }) => Promise<void>
}
