import type { LoadServiceClient } from "@reside/api/alpha/load.v1"
import type { OperationServiceClient } from "@reside/api/common/operation.v1"
import type { NotificationServiceClient } from "@reside/api/interaction/notification.v1"
import type { PrismaClient } from "../../database"
import type { EngineerAiRuntime } from "../ai-runtime"
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"
import { type CopilotSession, defineTool, type SessionConfig } from "@github/copilot-sdk"
import { waitForOperationSuccess } from "@reside/api"
import { logger, type StorageBucketService } from "@reside/common"
import { toError } from "@reside/utils"
import { z } from "zod"
import { strings } from "../../locale"

const COPILOT_SESSION_TIMEOUT_MS = 20 * 60 * 1000
const PROGRESS_NOTIFICATION_HISTORY_LIMIT = 5
const ENGINEER_SESSION_ARCHIVE_EXTENSION = "tgz"
const ENGINEER_SESSION_ARCHIVE_PREFIX = "sessions"
const ENGINEER_WORKSPACE_PREFIX = "reside-task"
const ENGINEER_SESSION_DIR = ".engineer-session"
const ENGINEER_SESSION_STATE_DIR = "session-state"

const issueDraftSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
})

const startPlanningInputSchema = z.object({
  subjectId: z.string().min(1),
  prompt: z.string().min(1),
  progressNotificationId: z.string().min(1),
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
  issueTitle: z.string().min(1),
  issueUrl: z.string().url(),
  repositoryUrl: z.string().url(),
  resultSummary: z.string().min(1),
})

const implementationResultSchema = z.object({
  taskId: z.string().min(1),
  status: z.enum(["IN_PROGRESS", "COMPLETED", "FAILED", "CANCELLED"]),
  resultSummary: z.string().optional(),
  errorMessage: z.string().optional(),
})

type StartPlanningInput = z.infer<typeof startPlanningInputSchema>
type PlanningFeedbackInput = z.infer<typeof planningFeedbackInputSchema>
type TaskIdInput = z.infer<typeof taskIdInputSchema>
type RequestCancellationInput = z.infer<typeof requestCancellationInputSchema>
type RunImplementationInput = z.infer<typeof runImplementationInputSchema>

type TaskSnapshot = {
  taskId: string
  phase: "PLANNING" | "IMPLEMENTATION"
  status:
    | "PLANNING"
    | "PLAN_READY"
    | "IN_PROGRESS"
    | "COMPLETED"
    | "FAILED"
    | "REQUESTED_CANCELLATION"
    | "CANCELLED"
  issueTitle: string
  issueUrl: string
  repositoryUrl: string
}

type CopilotEnvironment = {
  workingDirectory: string
  repositoryPath: string
  sessionDirPath: string
  taskId: number
  storageBucketService: StorageBucketService
  sessionId: string | undefined
  dispose: () => Promise<void>
}

export function createCreateTaskActivities({
  runtime,
  prisma,
  notificationService,
  loadService,
  alphaOperationService,
  storageBucketService,
}: {
  runtime: EngineerAiRuntime
  prisma: PrismaClient
  notificationService: NotificationServiceClient
  loadService: LoadServiceClient
  alphaOperationService: OperationServiceClient
  storageBucketService: StorageBucketService
}) {
  return {
    startPlanningInteraction: async (input: StartPlanningInput) => {
      const parsedInput = startPlanningInputSchema.parse(input)
      const repository = await runtime.getRepositoryTarget()
      const repositoryUrl = `https://github.com/${repository.owner}/${repository.name}`

      const task = await prisma.task.create({
        data: {
          phase: "PLANNING",
          status: "PLANNING",
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
        environment = await createCopilotEnvironment(
          runtime,
          storageBucketService,
          task.id,
          iteration.id,
        )

        const draft = await runPlanningSession({
          runtime,
          environment,
          notificationService,
          progressNotificationId: parsedInput.progressNotificationId,
          prompt: parsedInput.prompt,
          repository,
          taskId: task.id,
        })

        const issue = await upsertTaskIssue({
          prisma,
          runtime,
          taskId: task.id,
          owner: repository.owner,
          repo: repository.name,
          issueTitle: draft.title,
          issueBody: draft.body,
        })

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

        await syncTaskIssueState({
          runtime,
          prisma,
          taskId: task.id,
          state: "CLOSED",
          stateReason: "NOT_PLANNED",
        })

        throw error
      } finally {
        if (environment) {
          await environment.dispose()
        }
      }
    },

    submitPlanningFeedbackInteraction: async (input: PlanningFeedbackInput) => {
      const parsedInput = planningFeedbackInputSchema.parse(input)
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

      const environment = await createCopilotEnvironment(
        runtime,
        storageBucketService,
        dbTaskId,
        iteration.id,
      )

      try {
        const draft = await runPlanningSession({
          runtime,
          environment,
          notificationService,
          progressNotificationId: parsedInput.progressNotificationId,
          prompt: parsedInput.feedback,
          repository,
          taskId: dbTaskId,
        })

        const issue = await upsertTaskIssue({
          prisma,
          runtime,
          taskId: dbTaskId,
          owner: repository.owner,
          repo: repository.name,
          issueTitle: draft.title,
          issueBody: draft.body,
        })

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

        await syncTaskIssueState({
          runtime,
          prisma,
          taskId: dbTaskId,
          state: "CLOSED",
          stateReason: "NOT_PLANNED",
        })

        throw error
      } finally {
        await environment.dispose()
      }
    },

    approveTask: async (input: TaskIdInput) => {
      const parsedInput = taskIdInputSchema.parse(input)
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

      await syncTaskIssueState({
        runtime,
        prisma,
        taskId: dbTaskId,
        state: "OPEN",
      })
    },

    requestCancellation: async (input: RequestCancellationInput) => {
      const parsedInput = requestCancellationInputSchema.parse(input)
      const dbTaskId = parseDbTaskId(parsedInput.taskId)

      const task = await prisma.task.findUnique({
        where: {
          id: dbTaskId,
        },
      })

      if (!task) {
        throw new Error(`Unknown task "${parsedInput.taskId}"`)
      }

      if (task.status === "IN_PROGRESS") {
        await prisma.task.update({
          where: {
            id: dbTaskId,
          },
          data: {
            status: "REQUESTED_CANCELLATION",
          },
        })

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

      await syncTaskIssueState({
        runtime,
        prisma,
        taskId: dbTaskId,
        state: "CLOSED",
        stateReason: "NOT_PLANNED",
      })
    },

    runImplementationInteraction: async (input: RunImplementationInput) => {
      const parsedInput = runImplementationInputSchema.parse(input)
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

      const environment = await createCopilotEnvironment(
        runtime,
        storageBucketService,
        dbTaskId,
        iteration.id,
      )
      const copilotClient = runtime.getCopilotClient()
      const [owner, repo] = [repository.owner, repository.name]

      let summary = ""
      let failureMessage = ""
      const reportImplementationProgress = createProgressReporter({
        notificationService,
        notificationId: parsedInput.progressNotificationId,
        title: strings.notifications.taskExecution.inProgressTitle,
        prefix: strings.notifications.taskExecution.runningAwaitingInput,
        actions: [
          {
            name: "cancel",
            title: strings.notifications.taskExecution.actions.cancel,
          },
        ],
      })

      try {
        const sessionConfig: SessionConfig = {
          model: "gpt-5.3-codex",
          workingDirectory: environment.repositoryPath,
          configDir: environment.sessionDirPath,
          onPermissionRequest: async () => ({ kind: "approved" as const }),
          tools: [
            createPullRequestTool({
              runtime,
              owner,
              repo,
              repositoryPath: environment.repositoryPath,
              branchName: `replica/task-${dbTaskId}/${iteration.id}`,
              issueNumber: task.issueId ?? undefined,
            }),
            createDeployReplicaTool({
              runtime,
              loadService,
              alphaOperationService,
              owner,
              repo,
              branchName: `replica/task-${dbTaskId}/${iteration.id}`,
              issueNumber: task.issueId ?? undefined,
            }),
          ],
          hooks: {
            onPreToolUse: async toolInvocation => {
              const bashCommand = extractBashCommand(toolInvocation)
              if (isForbiddenImplementationGitCommand(bashCommand)) {
                return {
                  permissionDecision: "deny" as const,
                  permissionDecisionReason:
                    "Use git add/git commit only. Do not run git push or branch-manipulation commands; use create_pull_request tool.",
                }
              }

              return {
                permissionDecision: "allow" as const,
              }
            },
          },
        }

        const session = await createOrResumeSession({
          copilotClient,
          environment,
          sessionConfig,
          flow: "implementation",
          taskId: dbTaskId,
          iterationId: iteration.id,
        })

        const unsubscribeRealtimeLogs = registerRealtimeSessionLogs(
          session,
          "implementation",
          reportImplementationProgress,
        )

        const cancellationWatcher = watchRequestedCancellation({
          prisma,
          taskId: dbTaskId,
          onCancel: async () => {
            await session.disconnect()
          },
        })

        try {
          const finalMessage = await session.sendAndWait(
            {
              prompt: [
                `Repository: ${owner}/${repo}`,
                `Branch: replica/task-${dbTaskId}/${iteration.id}`,
                task.issueId
                  ? `Issue: #${task.issueId}`
                  : "Issue: create and link one before deploy.",
                "You are in implementation phase.",
                "Git environment is already configured for commits on the provided branch.",
                "Do not run git push and do not manipulate branches (no checkout/switch/branch/rebase/cherry-pick/reset).",
                "Use only git add/git commit on the provided branch.",
                "Use create_pull_request tool to push commits, create PR, merge with rebase, and delete source branch.",
                "Before calling deploy_replica, you MUST commit your changes, then call create_pull_request with your own descriptive title.",
                "PR body MUST link the issue (for example: Closes #<issue-number>).",
                "Pull requests must use rebase merge and delete source branch.",
                "Use deploy_replica tool only after merged PR exists on this branch.",
                "If deploy_replica fails, report the exact failure reason and continue by fixing the root cause.",
                "Finish with a short 3-5 sentence summary in russian.",
                `Current user request: ${parsedInput.prompt}`,
              ].join("\n"),
            },
            COPILOT_SESSION_TIMEOUT_MS,
          )

          summary = extractSummaryFromFinalMessage(finalMessage?.data.content)
        } finally {
          cancellationWatcher.stop()
          unsubscribeRealtimeLogs()
        }

        const currentTask = await prisma.task.findUnique({
          where: {
            id: dbTaskId,
          },
        })

        if (!currentTask) {
          throw new Error(`Task "${parsedInput.taskId}" disappeared during execution`)
        }

        if (currentTask.status === "REQUESTED_CANCELLATION") {
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

          await syncTaskIssueState({
            runtime,
            prisma,
            taskId: dbTaskId,
            state: "CLOSED",
            stateReason: "NOT_PLANNED",
          })

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

        await syncTaskIssueState({
          runtime,
          prisma,
          taskId: dbTaskId,
          state: "CLOSED",
          stateReason: "COMPLETED",
        })

        await environment.dispose()

        return implementationResultSchema.parse({
          taskId: parsedInput.taskId,
          status: "COMPLETED",
          resultSummary: finalSummary,
        })
      } catch (error) {
        failureMessage = error instanceof Error ? error.message : String(error)

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

        await syncTaskIssueState({
          runtime,
          prisma,
          taskId: dbTaskId,
          state: "CLOSED",
          stateReason: "NOT_PLANNED",
        })

        await environment.dispose()

        return implementationResultSchema.parse({
          taskId: parsedInput.taskId,
          status: "FAILED",
          errorMessage: failureMessage,
        })
      }
    },

    reviveTaskFromFeedback: async (input: { taskId: string }) => {
      const dbTaskId = parseDbTaskId(input.taskId)

      await prisma.task.update({
        where: {
          id: dbTaskId,
        },
        data: {
          phase: "IMPLEMENTATION",
          status: "IN_PROGRESS",
        },
      })

      await syncTaskIssueState({
        runtime,
        prisma,
        taskId: dbTaskId,
        state: "OPEN",
      })
    },

    getTaskSnapshot: async (input: { taskId: string }): Promise<TaskSnapshot> => {
      const dbTaskId = parseDbTaskId(input.taskId)
      const repository = await runtime.getRepositoryTarget()
      const repositoryUrl = `https://github.com/${repository.owner}/${repository.name}`

      const task = await prisma.task.findUnique({
        where: {
          id: dbTaskId,
        },
      })

      if (!task) {
        throw new Error(`Unknown task "${input.taskId}"`)
      }

      if (!task.issueId) {
        throw new Error(`Task "${input.taskId}" is missing issue id`)
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

function createDeployReplicaTool({
  runtime,
  loadService,
  alphaOperationService,
  owner,
  repo,
  branchName,
  issueNumber,
}: {
  runtime: EngineerAiRuntime
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

        if (!mergedPullRequest) {
          throw new Error(
            `deploy_replica requires a merged pull request for branch "${branchName}". Create and merge PR first.`,
          )
        }

        if (mergedPullRequest.title.trim().length === 0) {
          throw new Error(
            `Merged pull request for branch "${branchName}" has empty title. Use a descriptive PR title and retry.`,
          )
        }

        if (
          issueNumber &&
          !isIssueLinkedInPullRequest({
            issueNumber,
            title: mergedPullRequest.title,
            body: mergedPullRequest.body,
          })
        ) {
          throw new Error(
            `Merged pull request #${mergedPullRequest.number} must link issue #${issueNumber} in title/body (e.g. "Closes #${issueNumber}").`,
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

        const loadReplicaResponse = await loadService.loadReplica({
          name: replicaName,
          image: `ghcr.io/exeteres/reside/replicas/${replicaName}:latest`,
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
        const errorDetails = describeToolError(error)
        logger.error(
          { error: toError(error) },
          'engineer deploy_replica failed replica="%s" branch="%s" details="%s"',
          replicaName,
          branchName,
          errorDetails,
        )

        throw new Error(`deploy_replica failed: ${errorDetails}`)
      }
    },
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

        if (issueNumber && !isIssueLinkedInPullRequest({ issueNumber, title, body })) {
          throw new Error(
            `Pull request body must link issue #${issueNumber} (for example: "Closes #${issueNumber}").`,
          )
        }

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
        const errorDetails = describeToolError(error)
        logger.error(
          { error: toError(error) },
          'engineer create_pull_request failed branch="%s" details="%s"',
          branchName,
          errorDetails,
        )

        throw new Error(`create_pull_request failed: ${errorDetails}`)
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

function isIssueLinkedInPullRequest({
  issueNumber,
  title,
  body,
}: {
  issueNumber: number
  title: string
  body: string
}): boolean {
  const combined = `${title}\n${body}`.toLowerCase()
  return combined.includes(`#${issueNumber}`)
}

async function runPlanningSession({
  runtime,
  environment,
  notificationService,
  progressNotificationId,
  prompt,
  repository,
  taskId,
}: {
  runtime: EngineerAiRuntime
  environment: CopilotEnvironment
  notificationService: NotificationServiceClient
  progressNotificationId: string
  prompt: string
  repository: Awaited<ReturnType<EngineerAiRuntime["getRepositoryTarget"]>>
  taskId: number
}): Promise<{ title: string; body: string; summary: string }> {
  const draftStatesBySessionId = new Map<
    string,
    { submittedDraft?: z.infer<typeof issueDraftSchema> }
  >()
  const copilotClient = runtime.getCopilotClient()

  const sessionConfig: SessionConfig = {
    model: "gpt-5.3-codex",
    workingDirectory: environment.repositoryPath,
    configDir: environment.sessionDirPath,
    onPermissionRequest: async () => ({ kind: "approved" as const }),
    tools: [createSubmitIssueDraftTool(draftStatesBySessionId)],
    hooks: {
      onPreToolUse: async toolInvocation => {
        if (
          [
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
          ].includes(toolInvocation.toolName)
        ) {
          return {
            permissionDecision: "allow" as const,
          }
        }

        return {
          permissionDecision: "deny" as const,
          permissionDecisionReason: "Planning phase allows only read-only and reporting tools",
        }
      },
    },
  }

  const session = await createOrResumeSession({
    copilotClient,
    environment,
    sessionConfig,
    flow: "planning",
    taskId,
  })

  const reportPlanningProgress = createProgressReporter({
    notificationService,
    notificationId: progressNotificationId,
    title: strings.notifications.taskAnalysis.title,
  })

  const unsubscribeRealtimeLogs = registerRealtimeSessionLogs(
    session,
    "planning",
    reportPlanningProgress,
  )

  let finalSummary = ""

  try {
    const finalMessage = await session.sendAndWait(
      {
        prompt: [
          `Repository: ${repository.owner}/${repository.name}`,
          `Task id: ${taskId}`,
          "Planning phase: produce issue draft update only.",
          "Issue title, issue body, and plan summary MUST be in russian.",
          "Use submit_issue_draft exactly once.",
          "End assistant response with short 3-5 sentence russian summary.",
          `User prompt: ${prompt}`,
        ].join("\n"),
      },
      COPILOT_SESSION_TIMEOUT_MS,
    )

    finalSummary = extractSummaryFromFinalMessage(finalMessage?.data.content)
  } finally {
    unsubscribeRealtimeLogs()
    await session.disconnect()
  }

  const draftState = draftStatesBySessionId.get(session.sessionId)
  if (!draftState?.submittedDraft) {
    throw new Error("Copilot did not submit issue draft via submit_issue_draft tool")
  }

  return {
    title: draftState.submittedDraft.title,
    body: draftState.submittedDraft.body,
    summary: finalSummary || "План обновлен и готов к подтверждению.",
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

async function createOrResumeSession({
  copilotClient,
  environment,
  sessionConfig,
  flow,
  taskId,
  iterationId,
}: {
  copilotClient: ReturnType<EngineerAiRuntime["getCopilotClient"]>
  environment: CopilotEnvironment
  sessionConfig: SessionConfig
  flow: "planning" | "implementation"
  taskId: number
  iterationId?: number
}): Promise<CopilotSession> {
  const previousSessionId = environment.sessionId

  if (previousSessionId) {
    try {
      const resumedSession = await copilotClient.resumeSession(previousSessionId, sessionConfig)
      environment.sessionId = resumedSession.sessionId
      await saveEnvironmentSessionArchive(environment)

      logger.info(
        'engineer copilot session resumed flow="%s" task_id="%s" iteration_id="%s" session_id="%s"',
        flow,
        String(taskId),
        iterationId ? String(iterationId) : "",
        resumedSession.sessionId,
      )

      return resumedSession
    } catch (error) {
      const errorValue = toError(error)

      logger.warn(
        { error: errorValue },
        'engineer failed to resume copilot session flow="%s" task_id="%s" iteration_id="%s" session_id="%s"',
        flow,
        String(taskId),
        iterationId ? String(iterationId) : "",
        previousSessionId,
      )
    }
  }

  const newSession = await copilotClient.createSession(sessionConfig)
  environment.sessionId = newSession.sessionId
  await saveEnvironmentSessionArchive(environment)

  logger.info(
    'engineer copilot session created flow="%s" task_id="%s" iteration_id="%s" session_id="%s" source="%s"',
    flow,
    String(taskId),
    iterationId ? String(iterationId) : "",
    newSession.sessionId,
    previousSessionId ? "fallback_after_resume_failure" : "new",
  )

  return newSession
}

async function createCopilotEnvironment(
  runtime: EngineerAiRuntime,
  storageBucketService: StorageBucketService,
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
  await runCommand(["git", "-C", repositoryPath, "config", "user.name", "reside-agent"])
  await runCommand([
    "git",
    "-C",
    repositoryPath,
    "config",
    "user.email",
    "2441612+reside-agent[bot]@users.noreply.github.com",
  ])
  await runCommand(["bun", "install", "--frozen-lockfile"], { cwd: repositoryPath })

  await mkdir(sessionDirPath, { recursive: true })
  const environment: CopilotEnvironment = {
    workingDirectory: worktreePath,
    repositoryPath,
    sessionDirPath,
    taskId,
    storageBucketService,
    sessionId: await restoreSessionArchive(storageBucketService, sessionDirPath, taskId),
    dispose: async () => {
      if (environment.sessionId) {
        await uploadSessionArchive(
          environment.storageBucketService,
          environment.sessionDirPath,
          environment.taskId,
          environment.sessionId,
        )
      }

      await rm(tempRoot, { recursive: true, force: true })
    },
  }

  return environment
}

async function saveEnvironmentSessionArchive(environment: CopilotEnvironment): Promise<void> {
  const sessionId = environment.sessionId?.trim()
  if (!sessionId) {
    return
  }

  environment.sessionId = sessionId
  await uploadSessionArchive(
    environment.storageBucketService,
    environment.sessionDirPath,
    environment.taskId,
    sessionId,
  )
}

async function restoreSessionArchive(
  storageBucketService: StorageBucketService,
  sessionDirPath: string,
  taskId: number,
): Promise<string | undefined> {
  const archiveKey = getSessionArchiveKey(taskId)
  const archivePath = join(sessionDirPath, `session.${ENGINEER_SESSION_ARCHIVE_EXTENSION}`)

  try {
    const object = await storageBucketService.client.send(
      new GetObjectCommand({
        Bucket: storageBucketService.bucket,
        Key: archiveKey,
      }),
    )

    if (!object.Body) {
      return undefined
    }

    const bytes = await object.Body.transformToByteArray()
    await writeFile(archivePath, Buffer.from(bytes))

    const sessionId = await readSessionIdFromArchive(archivePath)
    if (!sessionId) {
      logger.warn('engineer session archive "%s" has invalid layout', archiveKey)
      await rm(archivePath, { force: true })
      return undefined
    }

    const restoredSessionPath = getSessionStatePath(sessionDirPath, sessionId)
    await rm(restoredSessionPath, { recursive: true, force: true })
    await mkdir(restoredSessionPath, { recursive: true })
    await runCommand([
      "tar",
      "-xzf",
      archivePath,
      "-C",
      restoredSessionPath,
      "--strip-components=1",
    ])
    await rm(archivePath, { force: true })
    return sessionId
  } catch {
    return undefined
  }
}

async function uploadSessionArchive(
  storageBucketService: StorageBucketService,
  sessionDirPath: string,
  taskId: number,
  sessionId: string,
): Promise<void> {
  const sessionStatePath = getSessionStatePath(sessionDirPath, sessionId)
  try {
    await access(sessionStatePath)
  } catch {
    return
  }

  const archiveKey = getSessionArchiveKey(taskId)
  const archivePath = join(
    "/tmp",
    `${ENGINEER_WORKSPACE_PREFIX}-${taskId}`,
    `session-upload.${ENGINEER_SESSION_ARCHIVE_EXTENSION}`,
  )
  await runCommand([
    "tar",
    "-czf",
    archivePath,
    "-C",
    sessionStatePath,
    "--transform",
    `s,^,${sessionId}/,`,
    ".",
  ])
  const bytes = await readFile(archivePath)

  await storageBucketService.client.send(
    new PutObjectCommand({
      Bucket: storageBucketService.bucket,
      Key: archiveKey,
      Body: bytes,
      ContentType: "application/x-tar",
    }),
  )

  await rm(archivePath, { force: true })
}

function getSessionArchiveKey(taskId: number): string {
  return `${ENGINEER_SESSION_ARCHIVE_PREFIX}/task-${taskId}.${ENGINEER_SESSION_ARCHIVE_EXTENSION}`
}

function getSessionStatePath(sessionDirPath: string, sessionId: string): string {
  return join(sessionDirPath, ENGINEER_SESSION_STATE_DIR, sessionId)
}

async function readSessionIdFromArchive(archivePath: string): Promise<string | undefined> {
  const { stdout } = await runCommandWithOutput(["tar", "-tzf", archivePath])
  const topLevelEntries = stdout
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => line.split("/")[0])
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)

  const uniqueEntries = [...new Set(topLevelEntries)]
  if (uniqueEntries.length !== 1) {
    return undefined
  }

  const [candidate] = uniqueEntries
  if (
    !candidate ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
  ) {
    return undefined
  }

  return candidate
}

async function upsertTaskIssue({
  prisma,
  runtime,
  taskId,
  owner,
  repo,
  issueTitle,
  issueBody,
}: {
  prisma: PrismaClient
  runtime: EngineerAiRuntime
  taskId: number
  owner: string
  repo: string
  issueTitle: string
  issueBody: string
}) {
  const octokit = runtime.getOctokit()
  const task = await prisma.task.findUnique({
    where: {
      id: taskId,
    },
    select: {
      issueId: true,
    },
  })

  if (!task) {
    throw new Error(`Unknown task "${taskId}"`)
  }

  if (!task.issueId) {
    const createdIssue = await createIssueWithoutAssignee(
      octokit,
      owner,
      repo,
      issueTitle,
      issueBody,
    )

    await prisma.task.update({
      where: {
        id: taskId,
      },
      data: {
        issueId: createdIssue.number,
      },
    })

    return createdIssue
  }

  return await updateRepositoryIssue(octokit, owner, repo, task.issueId, {
    title: issueTitle,
    body: issueBody,
  })
}

type RepositoryIssue = {
  id: string
  number: number
  title: string
  body: string
  url: string
}

async function createIssueWithoutAssignee(
  octokit: ReturnType<EngineerAiRuntime["getOctokit"]>,
  owner: string,
  repo: string,
  title: string,
  body: string,
): Promise<RepositoryIssue> {
  const createdIssue = await octokit.rest.issues.create({
    owner,
    repo,
    title,
    body,
  })

  return {
    id: String(createdIssue.data.id),
    number: createdIssue.data.number,
    title: createdIssue.data.title,
    body: createdIssue.data.body ?? "",
    url: createdIssue.data.html_url,
  }
}

async function getRepositoryIssueByNumber(
  octokit: ReturnType<EngineerAiRuntime["getOctokit"]>,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<RepositoryIssue> {
  const issue = await octokit.rest.issues.get({
    owner,
    repo,
    issue_number: issueNumber,
  })

  return {
    id: String(issue.data.id),
    number: issue.data.number,
    title: issue.data.title,
    body: issue.data.body ?? "",
    url: issue.data.html_url,
  }
}

async function updateRepositoryIssue(
  octokit: ReturnType<EngineerAiRuntime["getOctokit"]>,
  owner: string,
  repo: string,
  issueNumber: number,
  updates: {
    title?: string
    body?: string
    state?: "OPEN" | "CLOSED"
  },
): Promise<RepositoryIssue> {
  const updatedIssue = await octokit.rest.issues.update({
    owner,
    repo,
    issue_number: issueNumber,
    title: updates.title,
    body: updates.body,
    state: updates.state?.toLowerCase() as "open" | "closed" | undefined,
  })

  return {
    id: String(updatedIssue.data.id),
    number: updatedIssue.data.number,
    title: updatedIssue.data.title,
    body: updatedIssue.data.body ?? "",
    url: updatedIssue.data.html_url,
  }
}

async function syncTaskIssueState({
  runtime,
  prisma,
  taskId,
  state,
  stateReason,
}: {
  runtime: EngineerAiRuntime
  prisma: PrismaClient
  taskId: number
  state: "OPEN" | "CLOSED"
  stateReason?: "COMPLETED" | "NOT_PLANNED"
}): Promise<void> {
  const task = await prisma.task.findUnique({
    where: {
      id: taskId,
    },
    select: {
      issueId: true,
    },
  })

  if (!task?.issueId) {
    return
  }

  const repository = await runtime.getRepositoryTarget()
  await updateRepositoryIssueState(runtime.getOctokit(), {
    owner: repository.owner,
    repo: repository.name,
    issueNumber: task.issueId,
    state,
    stateReason,
  })
}

async function updateRepositoryIssueState(
  octokit: ReturnType<EngineerAiRuntime["getOctokit"]>,
  input: {
    owner: string
    repo: string
    issueNumber: number
    state: "OPEN" | "CLOSED"
    stateReason?: "COMPLETED" | "NOT_PLANNED"
  },
): Promise<void> {
  await octokit.rest.issues.update({
    owner: input.owner,
    repo: input.repo,
    issue_number: input.issueNumber,
    state: input.state.toLowerCase() as "open" | "closed",
    state_reason:
      input.state === "CLOSED" && input.stateReason
        ? mapIssueStateReason(input.stateReason)
        : undefined,
  })
}

function mapIssueStateReason(reason: "COMPLETED" | "NOT_PLANNED"): "completed" | "not_planned" {
  return reason === "COMPLETED" ? "completed" : "not_planned"
}

function registerRealtimeSessionLogs(
  session: CopilotSession,
  context: "planning" | "implementation",
  onProgressReported: (progressLine: string) => Promise<void>,
): () => void {
  const unsubscribers = [
    session.on("assistant.message", event => {
      const content = event.data.content.trim()
      if (content.length === 0) {
        return
      }

      logger.info(
        'engineer copilot assistant message context="%s" message_id="%s" content="%s"',
        context,
        event.data.messageId,
        content,
      )
    }),
    session.on("tool.execution_start", event => {
      const argumentSummary = summarizeToolArguments(event.data.toolName, event.data.arguments)

      logger.info(
        'engineer copilot tool execution started context="%s" tool_name="%s" tool_call_id="%s" args="%s"',
        context,
        event.data.toolName,
        event.data.toolCallId,
        argumentSummary,
      )

      if (event.data.toolName === "report_intent") {
        void onProgressReported(extractReportIntentProgress(event.data.arguments)).catch(error => {
          const errorValue = toError(error)

          logger.warn(
            { error: errorValue },
            'engineer copilot progress update failed context="%s"',
            context,
          )
        })
      }
    }),
  ]

  return () => {
    for (const unsubscribe of unsubscribers) {
      unsubscribe()
    }
  }
}

function summarizeToolArguments(toolName: string, argumentsValue: unknown): string {
  if (!argumentsValue || typeof argumentsValue !== "object") {
    return "{}"
  }

  const typedArguments = argumentsValue as Record<string, unknown>

  if (toolName === "bash") {
    const command = typeof typedArguments.command === "string" ? typedArguments.command : ""
    return `command=${truncateOneLine(command, 1000)}`
  }

  const pathKeys = [
    "filePath",
    "path",
    "dirPath",
    "workspaceRoot",
    "workingDirectory",
    "includePattern",
    "query",
  ]

  const pathParts = pathKeys
    .map(key => {
      const value = typedArguments[key]
      if (typeof value !== "string" || value.length === 0) {
        return undefined
      }

      return `${key}=${truncateOneLine(value, 180)}`
    })
    .filter((value): value is string => Boolean(value))

  if (pathParts.length > 0) {
    return pathParts.join(" ")
  }

  const summary = Object.entries(typedArguments)
    .filter(([key]) => !["content", "newCode", "codeSnippet", "prompt"].includes(key))
    .map(([key, value]) => {
      if (typeof value === "string") {
        return `${key}=${truncateOneLine(value, 120)}`
      }

      if (typeof value === "number" || typeof value === "boolean") {
        return `${key}=${String(value)}`
      }

      if (Array.isArray(value)) {
        return `${key}=[${value.length}]`
      }

      if (value && typeof value === "object") {
        return `${key}={...}`
      }

      return `${key}=null`
    })
    .join(" ")

  return summary.length > 0 ? summary : "{}"
}

function extractBashCommand(toolInvocation: unknown): string {
  if (!toolInvocation || typeof toolInvocation !== "object") {
    return ""
  }

  const invocation = toolInvocation as {
    toolName?: string
    arguments?: unknown
    input?: unknown
  }
  if (invocation.toolName !== "bash") {
    return ""
  }

  const candidates = [invocation.arguments, invocation.input]
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") {
      continue
    }

    const command = (candidate as { command?: unknown }).command
    if (typeof command === "string") {
      return command
    }
  }

  return ""
}

function isForbiddenImplementationGitCommand(command: string): boolean {
  if (command.trim().length === 0) {
    return false
  }

  const normalizedCommand = command.replace(/\s+/g, " ").trim().toLowerCase()
  const forbiddenPatterns = [
    /(^|\s)git\s+push(\s|$)/,
    /(^|\s)git\s+checkout(\s|$)/,
    /(^|\s)git\s+switch(\s|$)/,
    /(^|\s)git\s+branch(\s|$)/,
    /(^|\s)git\s+rebase(\s|$)/,
    /(^|\s)git\s+cherry-pick(\s|$)/,
    /(^|\s)git\s+reset(\s|$)/,
  ]

  return forbiddenPatterns.some(pattern => pattern.test(normalizedCommand))
}

function truncateOneLine(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, maxLength)}...`
}

async function updateProgressNotification(
  notificationService: NotificationServiceClient,
  notificationId: string,
  update: {
    title: string
    progressLines: string[]
    prefix?: string
    actions?: Array<{
      name: string
      title: string
    }>
  },
): Promise<void> {
  const progressLines = update.progressLines
    .slice(-PROGRESS_NOTIFICATION_HISTORY_LIMIT)
    .map(line => `> ${line}`)
  const content = [update.prefix, progressLines.length > 0 ? "" : undefined, ...progressLines]
    .filter((line): line is string => typeof line === "string")
    .join("\n")

  await notificationService.updateNotification({
    notificationId,
    title: update.title,
    content,
    actions: update.actions ?? [],
  })
}

function createProgressReporter(input: {
  notificationService: NotificationServiceClient
  notificationId: string
  title: string
  prefix?: string
  actions?: Array<{
    name: string
    title: string
  }>
}): (progressLine: string) => Promise<void> {
  const progressLines: string[] = []

  return async progressLine => {
    const normalizedProgressLine = normalizeProgressLine(progressLine)
    if (!normalizedProgressLine) {
      return
    }

    await updateProgressNotification(input.notificationService, input.notificationId, {
      title: input.title,
      prefix: input.prefix,
      actions: input.actions,
      progressLines: appendProgressLine(progressLines, normalizedProgressLine),
    })
  }
}

function appendProgressLine(progressLines: string[], progressLine: string): string[] {
  progressLines.push(progressLine)
  if (progressLines.length > PROGRESS_NOTIFICATION_HISTORY_LIMIT) {
    progressLines.splice(0, progressLines.length - PROGRESS_NOTIFICATION_HISTORY_LIMIT)
  }

  return progressLines
}

function extractReportIntentProgress(argumentsValue: unknown): string {
  if (!argumentsValue || typeof argumentsValue !== "object") {
    return ""
  }

  const typedArguments = argumentsValue as Record<string, unknown>
  for (const key of ["intent", "task", "title", "description", "progress", "message"]) {
    const value = typedArguments[key]
    if (typeof value === "string") {
      return value
    }
  }

  return ""
}

function normalizeProgressLine(value: string): string | undefined {
  const normalized = value
    .split("\n")
    .map(line => line.trim())
    .find(line => line.length > 0)

  if (!normalized) {
    return undefined
  }

  const lowercase = normalized.toLowerCase()
  return (
    lowercase
      .replace(/[.!?,:;…]+$/g, "")
      .slice(0, 120)
      .trim() || undefined
  )
}

function extractSummaryFromFinalMessage(content: string | undefined): string {
  const normalized = content?.trim() ?? ""
  if (normalized.length > 0) {
    return normalized.slice(0, 2000)
  }

  return strings.notifications.taskExecution.defaultSummary
}

async function getNextIterationNumber(prisma: PrismaClient, taskId: number): Promise<number> {
  const aggregate = await prisma.taskIteration.aggregate({
    where: {
      taskId,
    },
    _max: {
      iteration: true,
    },
  })

  return (aggregate._max.iteration ?? 0) + 1
}

function parseDbTaskId(taskId: string): number {
  const parsedTaskId = Number.parseInt(taskId, 10)
  if (!Number.isInteger(parsedTaskId) || parsedTaskId <= 0) {
    throw new Error(`Invalid task id format "${taskId}"`)
  }

  return parsedTaskId
}

function watchRequestedCancellation({
  prisma,
  taskId,
  onCancel,
}: {
  prisma: PrismaClient
  taskId: number
  onCancel: () => Promise<void>
}) {
  let stopped = false
  let fired = false

  const loop = (async () => {
    while (!stopped && !fired) {
      const task = await prisma.task.findUnique({
        where: {
          id: taskId,
        },
        select: {
          status: true,
        },
      })

      if (task?.status === "REQUESTED_CANCELLATION") {
        fired = true
        await onCancel()
        return
      }

      await sleep(1000)
    }
  })().catch(error => {
    const errorValue = toError(error)

    logger.warn(
      { error: errorValue },
      'engineer cancellation watch failed task_id="%s"',
      String(taskId),
    )
  })

  return {
    stop: () => {
      stopped = true
      void loop
    },
  }
}

async function runCommand(command: string[], options?: { cwd?: string }): Promise<void> {
  const result = await runCommandWithOutput(command, options)
  if (result.exitCode === 0) {
    return
  }
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
