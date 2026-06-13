export type BankSecurityAuditFinding = {
  severity: "medium" | "low" | "info"
  title: string
  impact: string
  recommendation: string
}

export type BankSecurityAuditReport = {
  summary: string
  criticalOrHighRiskFinding: boolean
  findings: BankSecurityAuditFinding[]
}
