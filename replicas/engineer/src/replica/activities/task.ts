import type { NotificationServiceClient } from "@reside/api/interaction/notification.v1"
import type { GenericOperationService } from "@reside/common"
import type { Operation, PrismaClient } from "../../database"
import type { EngineerTaskActivities } from "../../definitions"
import type { GitHubService } from "../business"
import { defineTool, type LanguageEngine, logger } from "@reside/common"
import { crypto as resideCrypto } from "@reside/common/encryption"
import OpenAI from "openai"
import { z } from "zod"
import { strings } from "../../locale"
import {
  createEnvironmentPrompt,
  createImplementationPrompt,
  createPlanningPrompt,
  createProgressReporter,
  extractSummaryFromFinalMessage,
  getNextIterationNumber,
  getRepositoryIssueByNumber,
  isTaskCancellationRequested,
  parseDbTaskId,
  syncTaskIssueState,
  upsertTaskIssue,
} from "../business"

const ENGINEER_NLS_IDLE_TIMEOUT_MS = 20 * 60_000
const ENGINEER_NLS_REASONING_EFFORT = "high"

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

const implementationOnlyTaskInputSchema = z.object({
  subjectId: z.string().min(1),
  progressNotificationId: z.string().min(1),
  topicId: z.string().min(1),
  previewTitle: z.string().min(1),
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

type CopilotEnvironment = FactoryEnvironment

export type FactoryEnvironment = {
  workingDirectory: string
  repositoryPath: string
  opencodeSessionId: string
  taskId: number
  branchName: string
  dispose: () => Promise<void>
}

export type CreateFactoryEnvironment = (args: {
  github: GitHubService
  taskId: number
  iterationId: number
}) => Promise<FactoryEnvironment>

type TaskActivityServices = {
  github: GitHubService
  createFactoryEnvironment: CreateFactoryEnvironment
  languageEngine: LanguageEngine
  prisma: PrismaClient
  notificationService: NotificationServiceClient
  operationService: GenericOperationService<Operation>
}

export function createTaskActivities({
  github,
  createFactoryEnvironment,
  languageEngine,
  prisma,
  notificationService,
  operationService,
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
      const repository = await github.getRepositoryTarget()
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
        environment = await createFactoryEnvironment({
          github,
          taskId: task.id,
          iterationId: iteration.id,
        })

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
          github,
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

        await syncTaskIssueState(prisma, github, task.id, "CLOSED", "NOT_PLANNED")

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
      const repository = await github.getRepositoryTarget()
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

      const environment = await createFactoryEnvironment({
        github,
        taskId: dbTaskId,
        iterationId: iteration.id,
      })

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
          github,
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

        await syncTaskIssueState(prisma, github, dbTaskId, "CLOSED", "NOT_PLANNED")

        return interactionResultSchema.parse({
          taskId: parsedInput.taskId,
          status: "FAILED",
          errorMessage: message,
        })
      } finally {
        await environment.dispose()
      }
    },

    async startImplementationOnlyTask({
      subjectId,
      progressNotificationId,
      topicId,
      previewTitle,
    }) {
      const parsedInput = implementationOnlyTaskInputSchema.parse({
        subjectId,
        progressNotificationId,
        topicId,
        previewTitle,
      })

      const task = await prisma.task.create({
        data: {
          phase: "IMPLEMENTATION",
          status: "IN_PROGRESS",
          topicId: parsedInput.topicId,
          previewTitle: parsedInput.previewTitle,
          progressNotificationId: parsedInput.progressNotificationId,
          createdBy: parsedInput.subjectId,
        },
      })

      return {
        taskId: String(task.id),
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

      await syncTaskIssueState(prisma, github, dbTaskId, "OPEN")
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
          await syncTaskIssueState(prisma, github, dbTaskId, "CLOSED", "NOT_PLANNED")
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
            await syncTaskIssueState(prisma, github, dbTaskId, "CLOSED", "NOT_PLANNED")
          }
        }

        return
      }

      if (task.status === "REQUESTED_CANCELLATION") {
        logger.info('engineer cancellation already requested task_id="%s"', String(dbTaskId))
        await syncTaskIssueState(prisma, github, dbTaskId, "CLOSED", "NOT_PLANNED")

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

      await syncTaskIssueState(prisma, github, dbTaskId, "CLOSED", "NOT_PLANNED")
    },

    async runImplementationInteraction({ taskId, prompt, progressNotificationId }) {
      const parsedInput = runImplementationInputSchema.parse({
        taskId,
        prompt,
        progressNotificationId,
      })
      const repository = await github.getRepositoryTarget()
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

      const environment = await createFactoryEnvironment({
        github,
        taskId: dbTaskId,
        iterationId: iteration.id,
      })
      const [owner, repo] = [repository.owner, repository.name]
      const issue = task.issueId
        ? await getRepositoryIssueByNumber(await github.getOctokit(), owner, repo, task.issueId)
        : undefined

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
          owner,
          repo,
          dbTaskId,
          iterationId: iteration.id,
          issue,
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

          await syncTaskIssueState(prisma, github, dbTaskId, "CLOSED", "NOT_PLANNED")

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

        await syncTaskIssueState(prisma, github, dbTaskId, "CLOSED", "COMPLETED")

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

          await syncTaskIssueState(prisma, github, dbTaskId, "CLOSED", "NOT_PLANNED")

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

        await syncTaskIssueState(prisma, github, dbTaskId, "CLOSED", "NOT_PLANNED")

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

      await syncTaskIssueState(prisma, github, dbTaskId, "OPEN")
    },

    async getTaskSnapshot({ taskId }) {
      const dbTaskId = parseDbTaskId(taskId)
      const repository = await github.getRepositoryTarget()
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
        await github.getOctokit(),
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

    async completeOperation({ operationId }) {
      await operationService.setCompleted(operationId)
    },

    async failOperation({ operationId, reason, message }) {
      await operationService.setFailed(operationId, reason, message)
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
  repository: Awaited<ReturnType<GitHubService["getRepositoryTarget"]>>
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
    throw new Error("Copilot did not submit issue draft via reside_submit_issue_draft tool")
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
  repository: Awaited<ReturnType<GitHubService["getRepositoryTarget"]>>
  prompt: string
  previewTitle: string
  taskId: number
}): Promise<string> {
  try {
    return await languageEngine.askStream(
      `task-${taskId}`,
      createEnvironmentPrompt(
        "reside-env-factory-background",
        createPlanningPrompt(repository, prompt, previewTitle),
      ),
      async frame => {
        await reportPlanningProgress.report(frame)
      },
      {
        workingDirectory: environment.repositoryPath,
        opencodeSessionId: environment.opencodeSessionId,
        reasoningEffort: ENGINEER_NLS_REASONING_EFFORT,
        idleTimeoutMs: ENGINEER_NLS_IDLE_TIMEOUT_MS,
        tools: [createSubmitIssueDraftTool(draftStatesBySessionId)],
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
  owner,
  repo,
  dbTaskId,
  iterationId,
  issue,
  prompt,
  prisma,
}: {
  languageEngine: LanguageEngine
  reportImplementationProgress: ReturnType<typeof createProgressReporter>
  environment: CopilotEnvironment
  owner: string
  repo: string
  dbTaskId: number
  iterationId: number
  issue?: {
    number: number
    title: string
    body: string
  }
  prompt: string
  prisma: PrismaClient
}): Promise<string> {
  try {
    return await languageEngine.askStream(
      `task-${dbTaskId}`,
      createEnvironmentPrompt(
        "reside-env-factory-background",
        [
          createImplementationPrompt(
            owner,
            repo,
            `replica/task-${dbTaskId}/${iterationId}`,
            issue,
            prompt,
          ),
          `When calling Engineer tools, pass workingDir exactly as the current repository directory for this session.`,
        ].join("\n\n"),
      ),
      async frame => {
        await reportImplementationProgress.report(frame)
      },
      {
        workingDirectory: environment.repositoryPath,
        opencodeSessionId: environment.opencodeSessionId,
        reasoningEffort: ENGINEER_NLS_REASONING_EFFORT,
        idleTimeoutMs: ENGINEER_NLS_IDLE_TIMEOUT_MS,
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
  return defineTool("reside_submit_issue_draft", {
    description: "Submit final GitHub issue draft title and body",
    parameters: issueDraftSchema,
    handler: async (parsedDraft, context) => {
      const existing = draftStatesBySessionId.get(context.invocationId) ?? {}
      existing.submittedDraft = parsedDraft
      draftStatesBySessionId.set(context.invocationId, existing)
      return "Issue draft accepted"
    },
  })
}
