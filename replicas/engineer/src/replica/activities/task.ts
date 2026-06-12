import type { PermissionRequestServiceClient } from "@reside/api/access/request.v1"
import type { LoadServiceClient } from "@reside/api/alpha/load.v1"
import type { OperationServiceClient } from "@reside/api/common/operation.v1"
import type { NotificationServiceClient } from "@reside/api/interaction/notification.v1"
import type { PrismaClient } from "../../database"
import type { EngineerTaskActivities } from "../../definitions"
import type { EngineerAiRuntime } from "../business"
import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { defineTool } from "@github/copilot-sdk"
import { waitForOperationSuccess } from "@reside/api"
import {
  type LanguageEngine,
  link,
  logger,
  parseResideManifest,
  RESIDE_MANIFEST_FILE,
} from "@reside/common"
import { crypto as resideCrypto } from "@reside/common/encryption"
import { WellKnownPermissions } from "@reside/registry"
import { toError } from "@reside/utils"
import OpenAI from "openai"
import { z } from "zod"
import { strings } from "../../locale"
import {
  CommitValidationError,
  createImplementationPrompt,
  createPlanningPrompt,
  createProgressReporter,
  extractFailureMessageFromLog,
  extractSummaryFromFinalMessage,
  extractWorkflowRunId,
  getNextIterationNumber,
  getRepositoryIssueByNumber,
  hasIssueClosingTagAtBodyEnd,
  isTaskCancellationRequested,
  parseDbTaskId,
  syncTaskIssueState,
  upsertTaskIssue,
  validateBranchCommitLogOutput,
  validatePullRequestTitle,
} from "../business"

const ENGINEER_WORKSPACE_PREFIX = "reside-task"
const ENGINEER_SESSION_DIR = ".engineer-session"
const ENGINEER_NLS_IDLE_TIMEOUT_MS = 120_000
const ENGINEER_IMPLEMENTATION_ALLOWED_SYSTEM_TOOLS = [
  "bash",
  "report_intent",
  "apply_patch",
  "git_apply_patch",
  "create",
  "edit",
  "edit_file",
  "read_file",
  "get_file_contents",
  "glob",
  "search_code",
  "search_code_subagent",
  "str_replace_editor",
  "fetch",
]

const issueDraftSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
})

const startPlanningInputSchema = z.object({
  subjectId: z.string().min(1),
  prompt: z.string().min(1),
  progressNotificationId: z.string().min(1),
  topicId: z.string().min(1),
  previewTitle: z.string().min(1),
})

const llmSecretSchema = z.object({
  endpoint: z.string().trim().min(1),
  "api-key": z.string().trim().min(1),
  "smart-model": z.string().trim().min(1),
})

const generatedTitleSchema = z.object({
  title: z.string().trim().min(1).max(80),
})

const planningFeedbackInputSchema = z.object({
  taskId: z.string().min(1),
  feedback: z.string().min(1),
  progressNotificationId: z.string().min(1),
})

const taskIdInputSchema = z.object({
  taskId: z.string().min(1),
})

const requestCancellationInputSchema = z.object({
  taskId: z.string().min(1),
})

const runImplementationInputSchema = z.object({
  taskId: z.string().min(1),
  prompt: z.string().min(1),
  progressNotificationId: z.string().min(1),
})

const interactionResultSchema = z.object({
  taskId: z.string().min(1),
  status: z.enum(["PLAN_READY", "FAILED"]),
  issueTitle: z.string().min(1).optional(),
  issueUrl: z.string().url().optional(),
  repositoryUrl: z.string().url().optional(),
  resultSummary: z.string().min(1).optional(),
  errorMessage: z.string().optional(),
})

const implementationResultSchema = z.object({
  taskId: z.string().min(1),
  status: z.enum(["IN_PROGRESS", "COMPLETED", "FAILED", "CANCELLED"]),
  resultSummary: z.string().optional(),
  errorMessage: z.string().optional(),
})

type CopilotEnvironment = {
  workingDirectory: string
  repositoryPath: string
  sessionDirPath: string
  taskId: number
  dispose: () => Promise<void>
}

type TaskActivityServices = {
  runtime: EngineerAiRuntime
  languageEngine: LanguageEngine
  prisma: PrismaClient
  notificationService: NotificationServiceClient
  permissionRequestService: PermissionRequestServiceClient
  accessOperationService: OperationServiceClient
  loadService: LoadServiceClient
  alphaOperationService: OperationServiceClient
}

export function createTaskActivities({
  runtime,
  languageEngine,
  prisma,
  notificationService,
  permissionRequestService,
  accessOperationService,
  loadService,
  alphaOperationService,
}: TaskActivityServices): EngineerTaskActivities {
  return {
    async generateTaskPreviewTitle({ prompt }) {
      const taskPrompt = prompt.trim()
      if (taskPrompt.length === 0) {
        throw new Error("Task prompt must not be empty")
      }

      const llmSecret = await resideCrypto.getSecret(llmSecretSchema, "llm")
      const client = new OpenAI({
        apiKey: llmSecret["api-key"],
        baseURL: llmSecret.endpoint,
      })

      const response = await client.chat.completions.create({
        model: llmSecret["smart-model"],
        messages: [
          {
            role: "system",
            content:
              "Generate a short content-less Russian title for an engineering task topic. " +
              "Do not include implementation details, issue numbers, markdown, quotes, or final punctuation. " +
              'Return only a valid JSON object with shape {"title":"..."} and no surrounding text.',
          },
          {
            role: "user",
            content: taskPrompt,
          },
        ],
      })

      const content = response.choices[0]?.message.content
      if (content === null || content === undefined || content.trim().length === 0) {
        throw new Error("OpenAI title response is empty")
      }

      return parseGeneratedTaskPreviewTitle(content)
    },

    async startPlanningInteraction({
      subjectId,
      prompt,
      progressNotificationId,
      topicId,
      previewTitle,
    }) {
      const parsedInput = startPlanningInputSchema.parse({
        subjectId,
        prompt,
        progressNotificationId,
        topicId,
        previewTitle,
      })
      const repository = await runtime.getRepositoryTarget()
      const repositoryUrl = `https://github.com/${repository.owner}/${repository.name}`

      const task = await prisma.task.create({
        data: {
          phase: "PLANNING",
          status: "PLANNING",
          topicId: parsedInput.topicId,
          previewTitle: parsedInput.previewTitle,
          progressNotificationId: parsedInput.progressNotificationId,
          createdBy: parsedInput.subjectId,
        },
      })

      const iteration = await prisma.taskIteration.create({
        data: {
          taskId: task.id,
          iteration: 1,
          phase: "PLANNING",
          prompt: parsedInput.prompt,
          createdBy: parsedInput.subjectId,
        },
      })

      let environment: CopilotEnvironment | undefined

      try {
        environment = await createCopilotEnvironment(runtime, task.id, iteration.id)

        const draft = await runPlanningSession({
          languageEngine,
          environment,
          notificationService,
          progressNotificationId: parsedInput.progressNotificationId,
          prompt: parsedInput.prompt,
          previewTitle: parsedInput.previewTitle,
          repository,
          taskId: task.id,
        })

        const issue = await upsertTaskIssue(
          prisma,
          runtime,
          task.id,
          repository.owner,
          repository.name,
          draft.title,
          draft.body,
        )

        await prisma.taskIteration.update({
          where: {
            id: iteration.id,
          },
          data: {
            resultSummary: draft.summary,
          },
        })

        await prisma.task.update({
          where: {
            id: task.id,
          },
          data: {
            status: "PLAN_READY",
            updatedBy: parsedInput.subjectId,
          },
        })

        return interactionResultSchema.parse({
          taskId: String(task.id),
          status: "PLAN_READY",
          issueTitle: issue.title,
          issueUrl: issue.url,
          repositoryUrl,
          resultSummary: draft.summary,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)

        await prisma.taskIteration.update({
          where: {
            id: iteration.id,
          },
          data: {
            errorMessage: message,
          },
        })

        await prisma.task.update({
          where: {
            id: task.id,
          },
          data: {
            status: "FAILED",
            updatedBy: parsedInput.subjectId,
          },
        })

        await syncTaskIssueState(prisma, runtime, task.id, "CLOSED", "NOT_PLANNED")

        return interactionResultSchema.parse({
          taskId: String(task.id),
          status: "FAILED",
          errorMessage: message,
        })
      } finally {
        if (environment) {
          await environment.dispose()
        }
      }
    },

    async submitPlanningFeedbackInteraction({ taskId, feedback, progressNotificationId }) {
      const parsedInput = planningFeedbackInputSchema.parse({
        taskId,
        feedback,
        progressNotificationId,
      })
      const repository = await runtime.getRepositoryTarget()
      const repositoryUrl = `https://github.com/${repository.owner}/${repository.name}`
      const dbTaskId = parseDbTaskId(parsedInput.taskId)
      const task = await prisma.task.findUnique({
        where: {
          id: dbTaskId,
        },
      })

      if (!task) {
        throw new Error(`Unknown task "${parsedInput.taskId}"`)
      }

      if (task.phase !== "PLANNING") {
        throw new Error(`Task "${parsedInput.taskId}" is no longer in planning phase`)
      }

      const iterationNumber = await getNextIterationNumber(prisma, dbTaskId)
      const iteration = await prisma.taskIteration.create({
        data: {
          taskId: dbTaskId,
          iteration: iterationNumber,
          phase: "PLANNING",
          prompt: parsedInput.feedback,
          createdBy: task.createdBy,
        },
      })

      const environment = await createCopilotEnvironment(runtime, dbTaskId, iteration.id)

      try {
        const draft = await runPlanningSession({
          languageEngine,
          environment,
          notificationService,
          progressNotificationId: parsedInput.progressNotificationId,
          prompt: parsedInput.feedback,
          previewTitle: task.previewTitle,
          repository,
          taskId: dbTaskId,
        })

        const issue = await upsertTaskIssue(
          prisma,
          runtime,
          dbTaskId,
          repository.owner,
          repository.name,
          draft.title,
          draft.body,
        )

        await prisma.taskIteration.update({
          where: {
            id: iteration.id,
          },
          data: {
            resultSummary: draft.summary,
          },
        })

        await prisma.task.update({
          where: {
            id: dbTaskId,
          },
          data: {
            status: "PLAN_READY",
            updatedBy: task.createdBy,
          },
        })

        return interactionResultSchema.parse({
          taskId: parsedInput.taskId,
          status: "PLAN_READY",
          issueTitle: issue.title,
          issueUrl: issue.url,
          repositoryUrl,
          resultSummary: draft.summary,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)

        await prisma.taskIteration.update({
          where: {
            id: iteration.id,
          },
          data: {
            errorMessage: message,
          },
        })

        await prisma.task.update({
          where: {
            id: dbTaskId,
          },
          data: {
            status: "FAILED",
          },
        })

        await syncTaskIssueState(prisma, runtime, dbTaskId, "CLOSED", "NOT_PLANNED")

        return interactionResultSchema.parse({
          taskId: parsedInput.taskId,
          status: "FAILED",
          errorMessage: message,
        })
      } finally {
        await environment.dispose()
      }
    },

    async approveTask({ taskId }) {
      const parsedInput = taskIdInputSchema.parse({ taskId })
      const dbTaskId = parseDbTaskId(parsedInput.taskId)

      await prisma.task.update({
        where: {
          id: dbTaskId,
        },
        data: {
          phase: "IMPLEMENTATION",
          status: "IN_PROGRESS",
        },
      })

      await syncTaskIssueState(prisma, runtime, dbTaskId, "OPEN")
    },

    async requestCancellation({ taskId }) {
      const parsedInput = requestCancellationInputSchema.parse({ taskId })
      const dbTaskId = parseDbTaskId(parsedInput.taskId)

      logger.info('engineer cancellation requested task_id="%s"', String(dbTaskId))

      const task = await prisma.task.findUnique({
        where: {
          id: dbTaskId,
        },
      })

      if (!task) {
        logger.warn('engineer cancellation requested for unknown task_id="%s"', String(dbTaskId))
        throw new Error(`Unknown task "${parsedInput.taskId}"`)
      }

      logger.info(
        'engineer cancellation current state task_id="%s" phase="%s" status="%s"',
        String(dbTaskId),
        task.phase,
        task.status,
      )

      if (task.status === "IN_PROGRESS") {
        const updateResult = await prisma.task.updateMany({
          where: {
            id: dbTaskId,
            status: "IN_PROGRESS",
          },
          data: {
            status: "REQUESTED_CANCELLATION",
          },
        })

        if (updateResult.count > 0) {
          logger.info('engineer cancellation marked as requested task_id="%s"', String(dbTaskId))
          await syncTaskIssueState(prisma, runtime, dbTaskId, "CLOSED", "NOT_PLANNED")
        } else {
          const currentTask = await prisma.task.findUnique({
            where: {
              id: dbTaskId,
            },
            select: {
              status: true,
            },
          })

          logger.warn(
            'engineer cancellation request was not applied task_id="%s" current_status="%s"',
            String(dbTaskId),
            currentTask?.status ?? "",
          )

          if (currentTask?.status === "REQUESTED_CANCELLATION") {
            await syncTaskIssueState(prisma, runtime, dbTaskId, "CLOSED", "NOT_PLANNED")
          }
        }

        return
      }

      if (task.status === "REQUESTED_CANCELLATION") {
        logger.info('engineer cancellation already requested task_id="%s"', String(dbTaskId))
        await syncTaskIssueState(prisma, runtime, dbTaskId, "CLOSED", "NOT_PLANNED")

        return
      }

      await prisma.task.update({
        where: {
          id: dbTaskId,
        },
        data: {
          status: "CANCELLED",
        },
      })

      logger.info('engineer cancellation completed immediately task_id="%s"', String(dbTaskId))

      await syncTaskIssueState(prisma, runtime, dbTaskId, "CLOSED", "NOT_PLANNED")
    },

    async runImplementationInteraction({ taskId, prompt, progressNotificationId }) {
      const parsedInput = runImplementationInputSchema.parse({
        taskId,
        prompt,
        progressNotificationId,
      })
      const repository = await runtime.getRepositoryTarget()
      const dbTaskId = parseDbTaskId(parsedInput.taskId)
      const task = await prisma.task.findUnique({
        where: {
          id: dbTaskId,
        },
      })

      if (!task) {
        throw new Error(`Unknown task "${parsedInput.taskId}"`)
      }

      if (task.phase !== "IMPLEMENTATION") {
        throw new Error(`Task "${parsedInput.taskId}" is not in implementation phase`)
      }

      if (task.status !== "IN_PROGRESS") {
        throw new Error(`Task "${parsedInput.taskId}" is not in running state`)
      }

      if (!task.issueId) {
        throw new Error(`Task "${parsedInput.taskId}" is missing issue id`)
      }

      const iterationNumber = await getNextIterationNumber(prisma, dbTaskId)
      const iteration = await prisma.taskIteration.create({
        data: {
          taskId: dbTaskId,
          iteration: iterationNumber,
          phase: "IMPLEMENTATION",
          prompt: parsedInput.prompt,
          createdBy: task.createdBy,
        },
      })

      const environment = await createCopilotEnvironment(runtime, dbTaskId, iteration.id)
      const [owner, repo] = [repository.owner, repository.name]

      let summary = ""
      let failureMessage = ""
      const reportImplementationProgress = createProgressReporter(
        notificationService,
        parsedInput.progressNotificationId,
        strings.notifications.taskExecution.inProgressTitle,
        strings.notifications.taskExecution.runningAwaitingInput,
        [
          {
            name: "cancel",
            title: strings.notifications.taskExecution.actions.cancel,
          },
        ],
      )

      try {
        const finalMessage = await runImplementationLanguageStream({
          languageEngine,
          reportImplementationProgress,
          environment,
          runtime,
          permissionRequestService,
          accessOperationService,
          loadService,
          alphaOperationService,
          owner,
          repo,
          dbTaskId,
          iterationId: iteration.id,
          issueNumber: task.issueId,
          prompt: parsedInput.prompt,
          prisma,
        })

        summary = extractSummaryFromFinalMessage(finalMessage)

        const currentTask = await prisma.task.findUnique({
          where: {
            id: dbTaskId,
          },
        })

        if (!currentTask) {
          throw new Error(`Task "${parsedInput.taskId}" disappeared during execution`)
        }

        logger.info(
          'engineer implementation interaction completed task_id="%s" current_status="%s"',
          String(dbTaskId),
          currentTask.status,
        )

        if (currentTask.status === "REQUESTED_CANCELLATION") {
          failureMessage = strings.notifications.taskExecution.cancelledSummary

          logger.info(
            'engineer implementation converting requested cancellation to cancelled task_id="%s"',
            String(dbTaskId),
          )

          await prisma.task.update({
            where: {
              id: dbTaskId,
            },
            data: {
              status: "CANCELLED",
            },
          })

          await prisma.taskIteration.update({
            where: {
              id: iteration.id,
            },
            data: {
              errorMessage: failureMessage,
            },
          })

          await syncTaskIssueState(prisma, runtime, dbTaskId, "CLOSED", "NOT_PLANNED")

          await environment.dispose()

          return implementationResultSchema.parse({
            taskId: parsedInput.taskId,
            status: "CANCELLED",
            errorMessage: failureMessage,
          })
        }

        const finalSummary = summary || strings.notifications.taskExecution.defaultSummary

        await prisma.task.update({
          where: {
            id: dbTaskId,
          },
          data: {
            status: "COMPLETED",
          },
        })

        await prisma.taskIteration.update({
          where: {
            id: iteration.id,
          },
          data: {
            resultSummary: finalSummary,
          },
        })

        await syncTaskIssueState(prisma, runtime, dbTaskId, "CLOSED", "COMPLETED")

        await environment.dispose()

        return implementationResultSchema.parse({
          taskId: parsedInput.taskId,
          status: "COMPLETED",
          resultSummary: finalSummary,
        })
      } catch (error) {
        failureMessage = error instanceof Error ? error.message : String(error)

        if (await isTaskCancellationRequested(prisma, dbTaskId)) {
          failureMessage = strings.notifications.taskExecution.cancelledSummary

          await prisma.task.update({
            where: {
              id: dbTaskId,
            },
            data: {
              status: "CANCELLED",
            },
          })

          await prisma.taskIteration.update({
            where: {
              id: iteration.id,
            },
            data: {
              errorMessage: failureMessage,
            },
          })

          await syncTaskIssueState(prisma, runtime, dbTaskId, "CLOSED", "NOT_PLANNED")

          await environment.dispose()

          return implementationResultSchema.parse({
            taskId: parsedInput.taskId,
            status: "CANCELLED",
            errorMessage: failureMessage,
          })
        }

        await prisma.task.update({
          where: {
            id: dbTaskId,
          },
          data: {
            status: "FAILED",
          },
        })

        await prisma.taskIteration.update({
          where: {
            id: iteration.id,
          },
          data: {
            errorMessage: failureMessage,
          },
        })

        await syncTaskIssueState(prisma, runtime, dbTaskId, "CLOSED", "NOT_PLANNED")

        await environment.dispose()

        return implementationResultSchema.parse({
          taskId: parsedInput.taskId,
          status: "FAILED",
          errorMessage: failureMessage,
        })
      }
    },

    async retryTask({ taskId }) {
      const dbTaskId = parseDbTaskId(taskId)
      const task = await prisma.task.findUnique({
        where: {
          id: dbTaskId,
        },
        select: {
          phase: true,
        },
      })

      if (!task) {
        throw new Error(`Unknown task "${taskId}"`)
      }

      await prisma.task.update({
        where: {
          id: dbTaskId,
        },
        data: {
          status: task.phase === "PLANNING" ? "PLANNING" : "IN_PROGRESS",
        },
      })

      await syncTaskIssueState(prisma, runtime, dbTaskId, "OPEN")
    },

    async getTaskSnapshot({ taskId }) {
      const dbTaskId = parseDbTaskId(taskId)
      const repository = await runtime.getRepositoryTarget()
      const repositoryUrl = `https://github.com/${repository.owner}/${repository.name}`

      const task = await prisma.task.findUnique({
        where: {
          id: dbTaskId,
        },
      })

      if (!task) {
        throw new Error(`Unknown task "${taskId}"`)
      }

      if (!task.issueId) {
        throw new Error(`Task "${taskId}" is missing issue id`)
      }

      const issue = await getRepositoryIssueByNumber(
        runtime.getOctokit(),
        repository.owner,
        repository.name,
        task.issueId,
      )

      return {
        taskId: String(task.id),
        phase: task.phase,
        status: task.status,
        issueTitle: issue.title,
        issueUrl: issue.url,
        repositoryUrl,
      }
    },
  }
}

export function parseGeneratedTaskPreviewTitle(content: string): { title: string } {
  let parsedContent: unknown
  try {
    parsedContent = JSON.parse(content)
  } catch (error) {
    throw new Error("OpenAI title response is not valid JSON", {
      cause: error,
    })
  }

  return generatedTitleSchema.parse(parsedContent)
}

function createDeployReplicaTool({
  runtime,
  permissionRequestService,
  accessOperationService,
  loadService,
  alphaOperationService,
  owner,
  repo,
  branchName,
  issueNumber,
}: {
  runtime: EngineerAiRuntime
  permissionRequestService: PermissionRequestServiceClient
  accessOperationService: OperationServiceClient
  loadService: LoadServiceClient
  alphaOperationService: OperationServiceClient
  owner: string
  repo: string
  branchName: string
  issueNumber?: number
}) {
  return defineTool("deploy_replica", {
    description:
      "Builds and pushes replica image via workflow dispatch from main, waits for completion, then loads replica through alpha",
    parameters: z.object({
      replicaName: z.string().min(1),
    }),
    handler: async ({ replicaName }) => {
      logger.info(
        'engineer deploy_replica started replica="%s" branch="%s"',
        replicaName,
        branchName,
      )

      try {
        const octokit = runtime.getOctokit()
        const startedAt = new Date()

        const mergedPullRequest = await getMergedPullRequestForBranch({
          octokit,
          owner,
          repo,
          branchName,
        })

        if (mergedPullRequest) {
          if (mergedPullRequest.title.trim().length === 0) {
            throw new Error(
              `Merged pull request for branch "${branchName}" has empty title. Use a descriptive PR title and retry.`,
            )
          }

          if (issueNumber && !hasIssueClosingTagAtBodyEnd(mergedPullRequest.body, issueNumber)) {
            throw new Error(
              `Merged pull request #${mergedPullRequest.number} must end body with "Closes #${issueNumber}".`,
            )
          }
        } else {
          logger.info(
            'engineer deploy_replica proceeding without merged PR replica="%s" branch="%s"',
            replicaName,
            branchName,
          )
        }

        await octokit.rest.actions.createWorkflowDispatch({
          owner,
          repo,
          workflow_id: "build-replica.yml",
          ref: "main",
          inputs: {
            replica_name: replicaName,
          },
        })

        const run = await waitForWorkflowRun({
          octokit,
          owner,
          repo,
          startedAt,
        })
        if (run.conclusion !== "success") {
          throw new Error(
            `Replica build workflow failed with conclusion "${run.conclusion}" (run: ${run.url}).`,
          )
        }

        const manifest = await loadReplicaManifestFromRepository({
          octokit,
          owner,
          repo,
          replicaName,
        })

        await requestReplicaLoadPermission({
          permissionRequestService,
          accessOperationService,
          replicaName,
          issueUrl: issueNumber
            ? `https://github.com/${owner}/${repo}/issues/${issueNumber}`
            : undefined,
        })

        const loadReplicaResponse = await loadService.loadReplica({
          name: replicaName,
          image: `${manifest.image}:${manifest.version}`,
        })

        if (!loadReplicaResponse.operation) {
          throw new Error("Alpha load operation was not returned")
        }

        await waitForOperationSuccess(loadReplicaResponse.operation, {
          operationService: alphaOperationService,
        })

        logger.info(
          'engineer deploy_replica completed replica="%s" branch="%s"',
          replicaName,
          branchName,
        )

        return `Replica ${replicaName} deployed successfully`
      } catch (error) {
        const errorDetails = describeToolError(error) || "unknown error"
        logger.error(
          { error: toError(error) },
          'engineer deploy_replica failed replica="%s" branch="%s" details="%s"',
          replicaName,
          branchName,
          errorDetails,
        )

        return `deploy_replica failed: ${errorDetails}`
      }
    },
  })
}

async function requestReplicaLoadPermission(input: {
  permissionRequestService: PermissionRequestServiceClient
  accessOperationService: OperationServiceClient
  replicaName: string
  issueUrl?: string
}): Promise<void> {
  const permissionSetName = `engineer:deploy:${input.replicaName}`
  const reason = input.issueUrl
    ? `Для деплоя реплики ${input.replicaName} в рамках ${link("задачи", input.issueUrl).html}.`
    : `Для деплоя реплики ${input.replicaName} в рамках задачи.`

  const response = await input.permissionRequestService.requestPermissions({
    reason,
    permissionSetName,
    items: [
      {
        permissionName: WellKnownPermissions.ALPHA_REPLICA_LOAD,
        scope: input.replicaName,
      },
    ],
  })

  if (!response.operation) {
    return
  }

  await waitForOperationSuccess(response.operation, {
    operationService: input.accessOperationService,
  })
}

function createPullRequestTool({
  runtime,
  owner,
  repo,
  repositoryPath,
  branchName,
  issueNumber,
}: {
  runtime: EngineerAiRuntime
  owner: string
  repo: string
  repositoryPath: string
  branchName: string
  issueNumber?: number
}) {
  return defineTool("create_pull_request", {
    description:
      "Pushes committed changes from current branch, creates pull request, merges it with rebase and deletes source branch",
    parameters: z.object({
      title: z.string().min(1),
      body: z.string().min(1),
    }),
    handler: async ({ title, body }) => {
      logger.info(
        'engineer create_pull_request started branch="%s" title="%s"',
        branchName,
        truncateOneLine(title, 160),
      )

      try {
        const octokit = runtime.getOctokit()
        const currentBranch = await getCurrentGitBranch(repositoryPath)

        if (currentBranch !== branchName) {
          throw new Error(
            `Before create_pull_request (create_pr_branch), switch git branch to "${branchName}" (current: "${currentBranch || "<detached>"}").`,
          )
        }

        validatePullRequestTitle(title)

        if (!hasIssueClosingTagAtBodyEnd(body, issueNumber)) {
          const suffix = issueNumber ? ` #${issueNumber}` : " #<issue-number>"
          throw new Error(`Pull request body must end with "Closes${suffix}".`)
        }

        await validateBranchCommitMessages(repositoryPath, branchName)

        await runCommand([
          "git",
          "-C",
          repositoryPath,
          "push",
          "--set-upstream",
          "origin",
          branchName,
        ])

        const existingPullRequests = await octokit.rest.pulls.list({
          owner,
          repo,
          state: "open",
          head: `${owner}:${branchName}`,
        })

        const existingPullRequest = existingPullRequests.data[0]
        const pullRequest = existingPullRequest
          ? (
              await octokit.rest.pulls.update({
                owner,
                repo,
                pull_number: existingPullRequest.number,
                title,
                body,
              })
            ).data
          : (
              await octokit.rest.pulls.create({
                owner,
                repo,
                base: "main",
                head: branchName,
                title,
                body,
              })
            ).data

        const ciCheckResult = await waitForPullRequestCiCheck({
          octokit,
          owner,
          repo,
          pullRequestNumber: pullRequest.number,
        })

        if (ciCheckResult.status !== "success") {
          throw new Error(`PR check ci:check failed: ${ciCheckResult.failureMessage}`)
        }

        await octokit.rest.pulls.merge({
          owner,
          repo,
          pull_number: pullRequest.number,
          merge_method: "rebase",
        })

        await octokit.rest.git
          .deleteRef({
            owner,
            repo,
            ref: `heads/${branchName}`,
          })
          .catch(() => undefined)

        logger.info(
          'engineer create_pull_request completed branch="%s" pr_number="%s"',
          branchName,
          String(pullRequest.number),
        )

        return `Pull request #${pullRequest.number} merged: ${pullRequest.html_url}`
      } catch (error) {
        const errorDetails = describeToolError(error) || "unknown error"
        const rewriteHint =
          error instanceof CommitValidationError
            ? "Rewrite invalid commit message(s) before retry. Keep each commit subject as a single-line lowercase conventional commit without body or trailers"
            : undefined
        const responseDetails = rewriteHint ? `${errorDetails}. ${rewriteHint}` : errorDetails
        logger.error(
          { error: toError(error) },
          'engineer create_pull_request failed branch="%s" details="%s"',
          branchName,
          errorDetails,
        )

        return `create_pull_request failed: ${responseDetails}`
      }
    },
  })
}

async function waitForWorkflowRun(input: {
  octokit: ReturnType<EngineerAiRuntime["getOctokit"]>
  owner: string
  repo: string
  startedAt: Date
}): Promise<{ conclusion: string | null; url: string }> {
  const minCreatedAt = input.startedAt.getTime() - 15_000

  for (let attempt = 0; attempt < 180; attempt += 1) {
    const runs = await input.octokit.rest.actions.listWorkflowRuns({
      owner: input.owner,
      repo: input.repo,
      workflow_id: "build-replica.yml",
      branch: "main",
      event: "workflow_dispatch",
      per_page: 10,
    })

    const run = runs.data.workflow_runs.find(
      candidate => new Date(candidate.created_at).getTime() >= minCreatedAt,
    )

    if (!run) {
      await sleep(2000)
      continue
    }

    if (run.status !== "completed") {
      await sleep(5000)
      continue
    }

    return {
      conclusion: run.conclusion,
      url: run.html_url,
    }
  }

  throw new Error("Timed out waiting for build-replica workflow completion")
}

async function loadReplicaManifestFromRepository(input: {
  octokit: ReturnType<EngineerAiRuntime["getOctokit"]>
  owner: string
  repo: string
  replicaName: string
}) {
  const manifestPath = `replicas/${input.replicaName}/${RESIDE_MANIFEST_FILE}`
  const response = await input.octokit.rest.repos.getContent({
    owner: input.owner,
    repo: input.repo,
    path: manifestPath,
    ref: "main",
  })

  if (Array.isArray(response.data) || response.data.type !== "file") {
    throw new Error(`Replica manifest "${manifestPath}" on main is not a file`)
  }

  if (typeof response.data.content !== "string") {
    throw new Error(`Replica manifest "${manifestPath}" on main has no file content`)
  }

  const content = Buffer.from(response.data.content, "base64").toString("utf8")
  const manifest = parseResideManifest(content)
  if (!manifest) {
    throw new Error(`Replica manifest "${manifestPath}" on main must define image and version`)
  }

  return manifest
}

async function waitForPullRequestCiCheck(input: {
  octokit: ReturnType<EngineerAiRuntime["getOctokit"]>
  owner: string
  repo: string
  pullRequestNumber: number
}): Promise<{ status: "success" } | { status: "failed"; failureMessage: string }> {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const pullRequest = await input.octokit.rest.pulls.get({
      owner: input.owner,
      repo: input.repo,
      pull_number: input.pullRequestNumber,
    })

    const checkRunsResponse = await input.octokit.rest.checks.listForRef({
      owner: input.owner,
      repo: input.repo,
      ref: pullRequest.data.head.sha,
      filter: "latest",
      per_page: 100,
    })

    const ciCheckRun = checkRunsResponse.data.check_runs.find(checkRun => {
      const checkRunName = checkRun.name.toLowerCase()
      return checkRunName === "ci:check" || checkRunName.includes("ci:check")
    })

    if (!ciCheckRun) {
      await sleep(2000)
      continue
    }

    if (ciCheckRun.status !== "completed") {
      await sleep(5000)
      continue
    }

    if (ciCheckRun.conclusion === "success") {
      return { status: "success" }
    }

    const failureMessage = await getCiCheckFailureMessage({
      octokit: input.octokit,
      owner: input.owner,
      repo: input.repo,
      checkRunDetailsUrl: ciCheckRun.details_url ?? "",
      checkRunName: ciCheckRun.name,
      checkRunSummary: ciCheckRun.output?.summary ?? "",
      checkRunText: ciCheckRun.output?.text ?? "",
      checkRunTitle: ciCheckRun.output?.title ?? "",
    })

    return {
      status: "failed",
      failureMessage,
    }
  }

  return {
    status: "failed",
    failureMessage: "Timed out waiting for ci:check status",
  }
}

async function getCiCheckFailureMessage(input: {
  octokit: ReturnType<EngineerAiRuntime["getOctokit"]>
  owner: string
  repo: string
  checkRunDetailsUrl: string
  checkRunName: string
  checkRunSummary: string
  checkRunText: string
  checkRunTitle: string
}): Promise<string> {
  const runId = extractWorkflowRunId(input.checkRunDetailsUrl)
  if (runId) {
    const logsMessage = await getWorkflowRunFailureLogMessage({
      octokit: input.octokit,
      owner: input.owner,
      repo: input.repo,
      runId,
      checkRunName: input.checkRunName,
    })

    if (logsMessage) {
      return logsMessage
    }
  }

  const checkRunMessage = [input.checkRunTitle, input.checkRunSummary, input.checkRunText]
    .map(value => value.trim())
    .find(value => value.length > 0)

  if (checkRunMessage) {
    return truncateOneLine(checkRunMessage, 1200)
  }

  return `ci:check failed (run details: ${input.checkRunDetailsUrl || "unavailable"})`
}

async function getWorkflowRunFailureLogMessage(input: {
  octokit: ReturnType<EngineerAiRuntime["getOctokit"]>
  owner: string
  repo: string
  runId: number
  checkRunName: string
}): Promise<string | undefined> {
  const jobsResponse = await input.octokit.rest.actions.listJobsForWorkflowRun({
    owner: input.owner,
    repo: input.repo,
    run_id: input.runId,
    per_page: 100,
  })

  const failedJob =
    jobsResponse.data.jobs.find(job => {
      return job.name.toLowerCase().includes("ci:check") && job.conclusion === "failure"
    }) ?? jobsResponse.data.jobs.find(job => job.conclusion === "failure")

  if (!failedJob) {
    return undefined
  }

  const logsResponse = await input.octokit.rest.actions.downloadJobLogsForWorkflowRun({
    owner: input.owner,
    repo: input.repo,
    job_id: failedJob.id,
  })

  const logDownloadUrl = logsResponse.url
  if (!logDownloadUrl) {
    return failedJob.steps?.find(step => step.conclusion === "failure")?.name
  }

  const response = await fetch(logDownloadUrl)
  if (!response.ok) {
    return failedJob.steps?.find(step => step.conclusion === "failure")?.name
  }

  const logText = (await response.text()).trim()
  if (logText.length === 0) {
    return failedJob.steps?.find(step => step.conclusion === "failure")?.name
  }

  return extractFailureMessageFromLog(logText)
}

async function getMergedPullRequestForBranch({
  octokit,
  owner,
  repo,
  branchName,
}: {
  octokit: ReturnType<EngineerAiRuntime["getOctokit"]>
  owner: string
  repo: string
  branchName: string
}): Promise<{ number: number; title: string; body: string } | undefined> {
  const pulls = await octokit.rest.pulls.list({
    owner,
    repo,
    state: "closed",
    head: `${owner}:${branchName}`,
    per_page: 20,
    sort: "updated",
    direction: "desc",
  })

  const mergedPullRequest = pulls.data.find(pull => {
    return Boolean(pull.merged_at)
  })

  if (!mergedPullRequest) {
    return undefined
  }

  return {
    number: mergedPullRequest.number,
    title: mergedPullRequest.title ?? "",
    body: mergedPullRequest.body ?? "",
  }
}

async function validateBranchCommitMessages(
  repositoryPath: string,
  branchName: string,
): Promise<void> {
  const { stdout } = await runCommandWithOutput([
    "git",
    "-C",
    repositoryPath,
    "log",
    "--format=%H%x00%s%x00%b%x00",
    `main..${branchName}`,
  ])

  validateBranchCommitLogOutput(stdout)
}

async function runPlanningSession({
  languageEngine,
  environment,
  notificationService,
  progressNotificationId,
  prompt,
  previewTitle,
  repository,
  taskId,
}: {
  languageEngine: LanguageEngine
  environment: CopilotEnvironment
  notificationService: NotificationServiceClient
  progressNotificationId: string
  prompt: string
  previewTitle: string
  repository: Awaited<ReturnType<EngineerAiRuntime["getRepositoryTarget"]>>
  taskId: number
}): Promise<{ title: string; body: string; summary: string }> {
  const draftStatesBySessionId = new Map<
    string,
    { submittedDraft?: z.infer<typeof issueDraftSchema> }
  >()

  const reportPlanningProgress = createProgressReporter(
    notificationService,
    progressNotificationId,
    strings.notifications.taskAnalysis.title,
  )

  const finalMessage = await runPlanningLanguageStream({
    languageEngine,
    environment,
    reportPlanningProgress,
    draftStatesBySessionId,
    repository,
    prompt,
    previewTitle,
    taskId,
  })

  const finalSummary = extractSummaryFromFinalMessage(finalMessage)
  const draftState = [...draftStatesBySessionId.values()].find(state => state.submittedDraft)
  if (!draftState?.submittedDraft) {
    throw new Error("Copilot did not submit issue draft via submit_issue_draft tool")
  }

  return {
    title: draftState.submittedDraft.title,
    body: draftState.submittedDraft.body,
    summary: finalSummary || "План обновлен и готов к подтверждению.",
  }
}

async function runPlanningLanguageStream({
  languageEngine,
  environment,
  reportPlanningProgress,
  draftStatesBySessionId,
  repository,
  prompt,
  previewTitle,
  taskId,
}: {
  languageEngine: LanguageEngine
  environment: CopilotEnvironment
  reportPlanningProgress: ReturnType<typeof createProgressReporter>
  draftStatesBySessionId: Map<string, { submittedDraft?: z.infer<typeof issueDraftSchema> }>
  repository: Awaited<ReturnType<EngineerAiRuntime["getRepositoryTarget"]>>
  prompt: string
  previewTitle: string
  taskId: number
}): Promise<string> {
  try {
    return await languageEngine.askStream(
      `task-${taskId}`,
      createPlanningPrompt(repository, prompt, previewTitle),
      async frame => {
        await reportPlanningProgress.report(frame)
      },
      {
        workingDirectory: environment.repositoryPath,
        configDir: environment.sessionDirPath,
        idleTimeoutMs: ENGINEER_NLS_IDLE_TIMEOUT_MS,
        tools: [createSubmitIssueDraftTool(draftStatesBySessionId)],
        allowedSystemTools: [
          "report_intent",
          "submit_issue_draft",
          "read_file",
          "list_dir",
          "rg",
          "view",
          "glob",
          "grep_search",
          "file_search",
          "semantic_search",
          "fetch_webpage",
        ],
      },
    )
  } finally {
    await reportPlanningProgress.flush()
  }
}

async function runImplementationLanguageStream({
  languageEngine,
  reportImplementationProgress,
  environment,
  runtime,
  permissionRequestService,
  accessOperationService,
  loadService,
  alphaOperationService,
  owner,
  repo,
  dbTaskId,
  iterationId,
  issueNumber,
  prompt,
  prisma,
}: {
  languageEngine: LanguageEngine
  reportImplementationProgress: ReturnType<typeof createProgressReporter>
  environment: CopilotEnvironment
  runtime: EngineerAiRuntime
  permissionRequestService: PermissionRequestServiceClient
  accessOperationService: OperationServiceClient
  loadService: LoadServiceClient
  alphaOperationService: OperationServiceClient
  owner: string
  repo: string
  dbTaskId: number
  iterationId: number
  issueNumber: number
  prompt: string
  prisma: PrismaClient
}): Promise<string> {
  try {
    return await languageEngine.askStream(
      `task-${dbTaskId}`,
      createImplementationPrompt(
        owner,
        repo,
        `replica/task-${dbTaskId}/${iterationId}`,
        issueNumber,
        prompt,
      ),
      async frame => {
        await reportImplementationProgress.report(frame)
      },
      {
        workingDirectory: environment.repositoryPath,
        configDir: environment.sessionDirPath,
        idleTimeoutMs: ENGINEER_NLS_IDLE_TIMEOUT_MS,
        tools: [
          createPullRequestTool({
            runtime,
            owner,
            repo,
            repositoryPath: environment.repositoryPath,
            branchName: `replica/task-${dbTaskId}/${iterationId}`,
            issueNumber,
          }),
          createDeployReplicaTool({
            runtime,
            permissionRequestService,
            accessOperationService,
            loadService,
            alphaOperationService,
            owner,
            repo,
            branchName: `replica/task-${dbTaskId}/${iterationId}`,
            issueNumber,
          }),
        ],
        allowedSystemTools: ENGINEER_IMPLEMENTATION_ALLOWED_SYSTEM_TOOLS,
        shouldCancel: async () => await isTaskCancellationRequested(prisma, dbTaskId),
        cancelPollIntervalMs: 1000,
      },
    )
  } finally {
    await reportImplementationProgress.flush()
  }
}

function createSubmitIssueDraftTool(
  draftStatesBySessionId: Map<string, { submittedDraft?: z.infer<typeof issueDraftSchema> }>,
) {
  return defineTool("submit_issue_draft", {
    description: "Submit final GitHub issue draft title and body",
    parameters: issueDraftSchema,
    handler: async (parsedDraft, context) => {
      const existing = draftStatesBySessionId.get(context.sessionId) ?? {}
      existing.submittedDraft = parsedDraft
      draftStatesBySessionId.set(context.sessionId, existing)
      return "Issue draft accepted"
    },
  })
}

async function createCopilotEnvironment(
  runtime: EngineerAiRuntime,
  taskId: number,
  iterationId: number,
): Promise<CopilotEnvironment> {
  const repository = await runtime.getRepositoryTarget()
  const authenticatedCloneUrl = await createAuthenticatedCloneUrl(
    runtime.getOctokit(),
    repository.cloneUrl,
  )
  const tempRoot = join("/tmp", `${ENGINEER_WORKSPACE_PREFIX}-${taskId}`)
  const worktreePath = join(tempRoot, "workspace")
  const repositoryPath = join(worktreePath, repository.name)
  const branchName = `replica/task-${taskId}/${iterationId}`
  const sessionDirPath = join(repositoryPath, ENGINEER_SESSION_DIR)

  await rm(tempRoot, { recursive: true, force: true })
  await mkdir(worktreePath, { recursive: true })

  await runCommand([
    "git",
    "clone",
    "--branch",
    "main",
    "--single-branch",
    authenticatedCloneUrl,
    repositoryPath,
  ])
  await runCommand(["git", "-C", repositoryPath, "checkout", "-b", branchName])
  await runCommand(["git", "-C", repositoryPath, "config", "user.name", "reside-agent[bot]"])
  await runCommand([
    "git",
    "-C",
    repositoryPath,
    "config",
    "user.email",
    "248754993+reside-agent[bot]@users.noreply.github.com",
  ])
  await runCommand(["bun", "install", "--frozen-lockfile"], { cwd: repositoryPath })

  await mkdir(sessionDirPath, { recursive: true })
  const environment: CopilotEnvironment = {
    workingDirectory: worktreePath,
    repositoryPath,
    sessionDirPath,
    taskId,
    dispose: async () => {
      await rm(tempRoot, { recursive: true, force: true })
    },
  }

  return environment
}

function truncateOneLine(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, maxLength)}...`
}

async function runCommand(command: string[], options?: { cwd?: string }): Promise<void> {
  const result = await runCommandWithOutput(command, options)
  if (result.exitCode === 0) {
    return
  }
}

async function getCurrentGitBranch(repositoryPath: string): Promise<string> {
  const { stdout } = await runCommandWithOutput([
    "git",
    "-C",
    repositoryPath,
    "branch",
    "--show-current",
  ])

  return stdout.trim()
}

async function runCommandWithOutput(
  command: string[],
  options?: { cwd?: string },
): Promise<{
  stdout: string
  stderr: string
  exitCode: number
}> {
  const commandText = sanitizeSensitiveLogText(truncateOneLine(command.join(" "), 300))
  const cwdText = options?.cwd ? truncateOneLine(options.cwd, 180) : ""
  logger.info('engineer command started command="%s" cwd="%s"', commandText, cwdText)

  const process = Bun.spawn(command, {
    stdout: "pipe",
    stderr: "pipe",
    cwd: options?.cwd,
  })

  const [stdout, stderr, exitCode] = await Promise.all([
    process.stdout.text(),
    process.stderr.text(),
    process.exited,
  ])

  if (exitCode === 0) {
    logger.info('engineer command completed command="%s" cwd="%s"', commandText, cwdText)
    return {
      stdout,
      stderr,
      exitCode,
    }
  }

  const stdoutText = sanitizeSensitiveLogText(truncateOneLine(stdout.trim(), 800))
  const stderrText = sanitizeSensitiveLogText(truncateOneLine(stderr.trim(), 800))
  logger.error(
    'engineer command failed command="%s" cwd="%s" exit_code="%s" stdout="%s" stderr="%s"',
    commandText,
    cwdText,
    String(exitCode),
    stdoutText,
    stderrText,
  )

  throw new Error(
    `Command failed (exit ${exitCode}): ${commandText}; stdout: ${stdoutText || "<empty>"}; stderr: ${stderrText || "<empty>"}`,
  )
}

async function createAuthenticatedCloneUrl(
  octokit: ReturnType<EngineerAiRuntime["getOctokit"]>,
  cloneUrl: string,
): Promise<string> {
  const authResult = await octokit.auth({
    type: "installation",
  })

  const token =
    typeof authResult === "object" && authResult !== null && "token" in authResult
      ? String(authResult.token ?? "").trim()
      : ""

  if (token.length === 0) {
    throw new Error("GitHub installation token is empty")
  }

  const encodedToken = encodeURIComponent(token)
  return cloneUrl.replace(
    "https://github.com/",
    `https://x-access-token:${encodedToken}@github.com/`,
  )
}

function sanitizeSensitiveLogText(value: string): string {
  return value.replace(/x-access-token:[^@\s]+@github\.com/gi, "x-access-token:***@github.com")
}

function describeToolError(error: unknown): string {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : String(error)

  const status =
    typeof error === "object" && error !== null && "status" in error
      ? String((error as { status?: unknown }).status ?? "")
      : ""

  const response =
    typeof error === "object" && error !== null && "response" in error
      ? (error as { response?: unknown }).response
      : undefined

  const responseStatus =
    response && typeof response === "object" && "status" in response
      ? String((response as { status?: unknown }).status ?? "")
      : ""
  const responseMessage =
    response && typeof response === "object" && "data" in response
      ? extractResponseMessage((response as { data?: unknown }).data)
      : ""

  const parts = [message]
  if (status.length > 0) {
    parts.push(`status=${status}`)
  }

  if (responseStatus.length > 0) {
    parts.push(`response_status=${responseStatus}`)
  }

  if (responseMessage.length > 0) {
    parts.push(`response_message=${responseMessage}`)
  }

  return truncateOneLine(parts.filter(Boolean).join("; "), 1500)
}

function extractResponseMessage(value: unknown): string {
  if (typeof value === "string") {
    return value
  }

  if (!value || typeof value !== "object") {
    return ""
  }

  if ("message" in value) {
    return String((value as { message?: unknown }).message ?? "")
  }

  if ("error" in value) {
    return String((value as { error?: unknown }).error ?? "")
  }

  try {
    return JSON.stringify(value)
  } catch {
    return ""
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}
