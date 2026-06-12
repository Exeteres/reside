export type BankActivities = {
  getBalance: (subjectId: string) => Promise<{ balance: string }>
  getHistory: (subjectId: string) => Promise<{ title: string; lines: string[] }>
  transfer: (subjectId: string, recipient: string, amount: string) => Promise<{ title: string }>
}
