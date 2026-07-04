import type { ApprovalResultJson } from "@reside/api/common/approval.v1"

export type ToolDecision = {
  result: Extract<ApprovalResultJson, "APPROVED" | "ESCALATED">
  resolution: string
}

export function buildJudgementPrompt(args: {
  decisionToken: string
  title: string
  content: string
}): string {
  return [
    "Decision instructions:",
    "1) First, evaluate static escalation rules from the system prompt.",
    "2) Then find relevant allow rules in memory by calling reside_find_notes with separate important words from the request.",
    "3) If no allow rule matches, or any escalation rule matches, choose ESCALATED.",
    "4) Never deny the request.",
    "5) You must call exactly one decision tool with a short resolution in Russian.",
    "",
    `Decision token: ${args.decisionToken}`,
    "You must pass this token to exactly one decision tool.",
    "",
    `Title:\n${args.title}`,
    "",
    `Content:\n${args.content}`,
  ].join("\n")
}

export function maskNonReplicaSubjectIds(input: string, mask: string): string {
  return input.replace(/\b([a-z][a-z0-9-]*):([a-zA-Z0-9._-]+)\b/g, (value, realm) => {
    if (realm === "replica") {
      return value
    }

    return `${realm}:${mask}`
  })
}
