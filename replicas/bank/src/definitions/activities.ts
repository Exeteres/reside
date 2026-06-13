export type BankActivities = {
  getBalance: (input: { subjectRhid: string }) => Promise<{ amount: string }>
  getTransactions: (input: { subjectRhid: string }) => Promise<{ lines: string[] }>
  transfer: (input: {
    senderSubjectRhid: string
    recipientSubjectRhid: string
    amount: number
  }) => Promise<{ amount: string }>
}
