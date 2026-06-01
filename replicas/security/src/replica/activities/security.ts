import type { GenericOperationService } from "@reside/common"
import type { LanguageActivities } from "@reside/common/workflow"
import type { Operation, PrismaClient } from "../../database"
import type { SecurityActivities } from "../../definitions"
import type { ToolDecision } from "../business"
import { randomUUID } from "node:crypto"
import { buildJudgementPrompt, maskNonReplicaSubjectIds } from "../business"

const MASKED_SUBJECT_SUFFIX = "***"
const DECISION_MISSING_MESSAGE = "Агент не вызвал инструмент решения (allow/escalate)."
const FAILURE_REASON = "APPROVAL_WORKFLOW_FAILED"

type SecurityActivityServices = {
  prisma: PrismaClient
  operationService: GenericOperationService<Operation>
  askLanguageEngine: LanguageActivities["askLanguageEngine"]
  consumeDecision: (decisionToken: string) => ToolDecision | undefined
}

export function createSecurityActivities({
  prisma,
  operationService,
  askLanguageEngine,
  consumeDecision,
}: SecurityActivityServices): SecurityActivities {
  return {
    async judgeApprovalRequest({ operationId }) {
      const approvalRequest = await prisma.approvalRequest.findUnique({
        where: {
          operationId,
        },
      })

      if (approvalRequest === null) {
        throw new Error(`Approval request for operation "${operationId}" is not found`)
      }

      const decisionToken = `${operationId}:${randomUUID()}`
      const sessionId = `approval-${operationId}`
      const maskedTitle = maskNonReplicaSubjectIds(approvalRequest.title, MASKED_SUBJECT_SUFFIX)
      const maskedContent = maskNonReplicaSubjectIds(approvalRequest.content, MASKED_SUBJECT_SUFFIX)

      await askLanguageEngine({
        sessionId,
        text: buildJudgementPrompt({
          decisionToken,
          title: maskedTitle,
          content: maskedContent,
        }),
      })

      const decision = consumeDecision(decisionToken)
      if (!decision) {
        throw new Error(DECISION_MISSING_MESSAGE)
      }

      return decision
    },

    async applyApprovalDecision({ operationId, result, resolution }) {
      await prisma.approvalRequest.update({
        where: {
          operationId,
        },
        data: {
          result,
          resolution,
          respondedAt: new Date(),
        },
      })

      await operationService.setCompleted(operationId)
    },

    async failApprovalOperation({ operationId, message }) {
      await operationService.setFailed(operationId, FAILURE_REASON, message)
    },
  }
}
