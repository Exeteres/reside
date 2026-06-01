import type { SessionConfig } from "@github/copilot-sdk"
import type { ToolDecision } from "../business"
import { defineTool } from "@github/copilot-sdk"
import { z } from "zod"

type DecisionToolArgs = {
  decisionToken: string
  resolution: string
}

type DecisionToolState = {
  tools: NonNullable<SessionConfig["tools"]>
  consumeDecision: (decisionToken: string) => ToolDecision | undefined
}

const decisionToolSchema = z.object({
  decisionToken: z.string().trim().min(1),
  resolution: z.string().trim().min(1).max(500),
})

export function createApprovalDecisionTools(): DecisionToolState {
  const decisions = new Map<string, ToolDecision>()
  const allowInvocations = new Set<string>()
  const escalateInvocations = new Set<string>()

  const ensureValidDecision = ({ decisionToken, resolution }: DecisionToolArgs) => {
    const token = decisionToken.trim()
    const message = resolution.trim()

    if (token.length === 0) {
      throw new Error("decisionToken must not be empty")
    }

    if (message.length === 0) {
      throw new Error("resolution must not be empty")
    }

    if (decisions.has(token)) {
      throw new Error(`Decision for token "${token}" is already set`)
    }

    return {
      token,
      message,
    }
  }

  const allowTool = defineTool("allow_request", {
    description: "Marks the approval request as APPROVED and stores the required resolution.",
    parameters: decisionToolSchema,
    handler: async input => {
      const parsed = ensureValidDecision(input)

      if (allowInvocations.has(parsed.token)) {
        throw new Error(`allow_request already called for token "${parsed.token}"`)
      }

      allowInvocations.add(parsed.token)

      decisions.set(parsed.token, {
        result: "APPROVED",
        resolution: parsed.message,
      })

      return {
        status: "approved",
      }
    },
  })

  const escalateTool = defineTool("escalate_request", {
    description: "Marks the approval request as ESCALATED and stores the required resolution.",
    parameters: decisionToolSchema,
    handler: async input => {
      const parsed = ensureValidDecision(input)

      if (escalateInvocations.has(parsed.token)) {
        throw new Error(`escalate_request already called for token "${parsed.token}"`)
      }

      escalateInvocations.add(parsed.token)

      decisions.set(parsed.token, {
        result: "ESCALATED",
        resolution: parsed.message,
      })

      return {
        status: "escalated",
      }
    },
  })

  return {
    tools: [allowTool, escalateTool],
    consumeDecision: decisionToken => {
      const token = decisionToken.trim()
      const decision = decisions.get(token)

      decisions.delete(token)
      allowInvocations.delete(token)
      escalateInvocations.delete(token)

      return decision
    },
  }
}
