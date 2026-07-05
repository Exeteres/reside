export type BankTransaction = {
  id: string
  kind: "ISSUE" | "TRANSFER"
  senderSubjectId?: string
  recipientSubjectId: string
  amount: string
  comment?: string
  createdAt: string
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
}
