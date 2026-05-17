import type { LoadServiceClient } from "@reside/api/alpha/load.v1"
import type { NotificationServiceClient } from "@reside/api/interaction/notification.v1"
import type { PrismaClient } from "../../database"
import type { EngineerAiRuntime } from "../ai-runtime"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"
import { type CopilotSession, defineTool, type SessionConfig } from "@github/copilot-sdk"
import { logger, type StorageBucketService } from "@reside/common"
import { toError } from "@reside/utils"
import { z } from "zod"
import { strings } from "../../locale"

const COPILOT_SESSION_TIMEOUT_MS = 20 * 60 * 1000
const GRAPHQL_FEATURES_HEADER = "issues_copilot_assignment_api_support"
const ENGINEER_SESSION_ARCHIVE_NAME = "session.tar"
const ENGINEER_SESSION_DIR = ".engineer-session"
const ENGINEER_SESSION_ID_FILE = "session-id"

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
  readSessionId: () => Promise<string | undefined>
  writeSessionId: (sessionId: string) => Promise<void>
  dispose: () => Promise<void>
}

export function createCreateTaskActivities({
  runtime,
  prisma,
  notificationService,
  loadService,
  storageBucketService,
}: {
  runtime: EngineerAiRuntime
  prisma: PrismaClient
  notificationService: NotificationServiceClient
  loadService: LoadServiceClient
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

      try {
        const sessionConfig: SessionConfig = {
          model: "gpt-5.3-codex",
          workingDirectory: environment.repositoryPath,
          configDir: environment.sessionDirPath,
          onPermissionRequest: async () => ({ kind: "approved" as const }),
          tools: [createDeployReplicaTool({ runtime, loadService, owner, repo })],
          hooks: {
            onPreToolUse: async () => {
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
          async progressLine => {
            const normalizedProgressLine = normalizeProgressLine(progressLine)
            if (!normalizedProgressLine) {
              return
            }

            await updateProgressNotification(
              notificationService,
              parsedInput.progressNotificationId,
              strings.notifications.taskExecution.inProgressTitle,
              normalizedProgressLine,
            )
          },
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
                "You are in implementation phase.",
                "You can edit code, run commands, make commits, and use create_pull_request.",
                "Pull requests must use rebase merge and delete source branch.",
                "If PR conflicts, rebase on latest main, resolve conflicts, commit, and retry create_pull_request.",
                "Use deploy_replica tool to perform full deploy sequence once implementation is complete.",
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
  owner,
  repo,
}: {
  runtime: EngineerAiRuntime
  loadService: LoadServiceClient
  owner: string
  repo: string
}) {
  return defineTool("deploy_replica", {
    description:
      "Builds and pushes replica image via workflow dispatch from main, waits for completion, then loads replica through alpha",
    parameters: z.object({
      replicaName: z.string().min(1),
    }),
    handler: async _args => {
      const input = z.object({ replicaName: z.string().min(1) }).parse(_args)
      const octokit = runtime.getOctokit()

      await octokit.rest.actions.createWorkflowDispatch({
        owner,
        repo,
        workflow_id: "build-replica.yml",
        ref: "main",
        inputs: {
          replica_name: input.replicaName,
        },
      })

      const run = await waitForWorkflowRun(octokit, owner, repo, input.replicaName)
      if (run.conclusion !== "success") {
        throw new Error(`Replica build workflow failed with conclusion "${run.conclusion}"`)
      }

      await loadService.loadReplica({
        name: input.replicaName,
        image: `ghcr.io/exeteres/reside/replicas/${input.replicaName}:latest`,
      })

      return `Replica ${input.replicaName} deployed successfully`
    },
  })
}

async function waitForWorkflowRun(
  octokit: ReturnType<EngineerAiRuntime["getOctokit"]>,
  owner: string,
  repo: string,
  replicaName: string,
): Promise<{ conclusion: string | null }> {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const runs = await octokit.rest.actions.listWorkflowRuns({
      owner,
      repo,
      workflow_id: "build-replica.yml",
      branch: "main",
      event: "workflow_dispatch",
      per_page: 10,
    })

    const run = runs.data.workflow_runs.find(candidate => {
      return candidate.display_title.includes(replicaName)
    })

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
    }
  }

  throw new Error("Timed out waiting for deploy workflow completion")
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

  const unsubscribeRealtimeLogs = registerRealtimeSessionLogs(
    session,
    "planning",
    async progressLine => {
      const normalizedProgressLine = normalizeProgressLine(progressLine)
      if (!normalizedProgressLine) {
        return
      }

      await updateProgressNotification(
        notificationService,
        progressNotificationId,
        strings.notifications.taskAnalysis.title,
        normalizedProgressLine,
      )
    },
  )

  let finalSummary = ""

  try {
    const finalMessage = await session.sendAndWait(
      {
        prompt: [
          `Repository: ${repository.owner}/${repository.name}`,
          `Task id: ${taskId}`,
          "Planning phase: produce issue draft update only.",
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
    handler: async (_args, context) => {
      const parsedDraft = issueDraftSchema.parse(_args)
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
  const previousSessionId = await environment.readSessionId()

  if (previousSessionId) {
    try {
      const resumedSession = await copilotClient.resumeSession(previousSessionId, sessionConfig)

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
  await environment.writeSessionId(newSession.sessionId)

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
  const tempRoot = await mkdtemp(join(tmpdir(), "reside-engineer-"))
  const worktreePath = join(tempRoot, "workspace")
  const repositoryPath = join(worktreePath, repository.name)
  const branchName = `replica/task-${taskId}/${iterationId}`
  const sessionDirPath = join(repositoryPath, ENGINEER_SESSION_DIR)
  const sessionIdPath = join(sessionDirPath, ENGINEER_SESSION_ID_FILE)

  await runCommand([
    "git",
    "clone",
    "--branch",
    "main",
    "--single-branch",
    repository.cloneUrl,
    repositoryPath,
  ])
  await runCommand(["git", "-C", repositoryPath, "checkout", "-b", branchName])

  await mkdir(sessionDirPath, { recursive: true })
  await restoreSessionArchive(storageBucketService, sessionDirPath)

  return {
    workingDirectory: worktreePath,
    repositoryPath,
    sessionDirPath,
    readSessionId: async () => {
      try {
        const sessionId = await readFile(sessionIdPath, "utf-8")
        return sessionId.trim() || undefined
      } catch {
        return undefined
      }
    },
    writeSessionId: async sessionId => {
      await writeFile(sessionIdPath, sessionId, "utf-8")
      await uploadSessionArchive(storageBucketService, sessionDirPath)
    },
    dispose: async () => {
      await uploadSessionArchive(storageBucketService, sessionDirPath)
      await rm(tempRoot, { recursive: true, force: true })
    },
  }
}

async function restoreSessionArchive(
  storageBucketService: StorageBucketService,
  sessionDirPath: string,
): Promise<void> {
  try {
    const object = await storageBucketService.client.send(
      new GetObjectCommand({
        Bucket: storageBucketService.bucket,
        Key: ENGINEER_SESSION_ARCHIVE_NAME,
      }),
    )

    if (!object.Body) {
      return
    }

    const archivePath = join(sessionDirPath, ENGINEER_SESSION_ARCHIVE_NAME)
    const bytes = await object.Body.transformToByteArray()
    await writeFile(archivePath, Buffer.from(bytes))
    await runCommand(["tar", "-xf", archivePath, "-C", sessionDirPath])
    await rm(archivePath, { force: true })
  } catch {
    return
  }
}

async function uploadSessionArchive(
  storageBucketService: StorageBucketService,
  sessionDirPath: string,
): Promise<void> {
  const archivePath = join(sessionDirPath, ENGINEER_SESSION_ARCHIVE_NAME)
  await runCommand(["tar", "-cf", archivePath, "-C", sessionDirPath, "."])
  const bytes = await readFile(archivePath)

  await storageBucketService.client.send(
    new PutObjectCommand({
      Bucket: storageBucketService.bucket,
      Key: ENGINEER_SESSION_ARCHIVE_NAME,
      Body: bytes,
      ContentType: "application/x-tar",
    }),
  )

  await rm(archivePath, { force: true })
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
  const repositoryInfo = await executeGraphqlWithFeatures<{
    repository: {
      id: string
    } | null
  }>(
    octokit,
    `
      query($owner: String!, $name: String!) {
        repository(owner: $owner, name: $name) {
          id
        }
      }
    `,
    {
      owner,
      name: repo,
    },
  )

  const repositoryId = repositoryInfo.repository?.id
  if (!repositoryId) {
    throw new Error(`Repository "${owner}/${repo}" was not found in GitHub response`)
  }

  const createdIssue = await executeGraphqlWithFeatures<{
    createIssue: {
      issue: {
        id: string
        number: number
        title: string
        body: string | null
        url: string
      } | null
    } | null
  }>(
    octokit,
    `
      mutation($repositoryId: ID!, $title: String!, $body: String!) {
        createIssue(
          input: {
            repositoryId: $repositoryId
            title: $title
            body: $body
          }
        ) {
          issue {
            id
            number
            title
            body
            url
          }
        }
      }
    `,
    {
      repositoryId,
      title,
      body,
    },
  )

  const issue = createdIssue.createIssue?.issue
  if (!issue) {
    throw new Error("GitHub issue creation did not return created issue")
  }

  return {
    id: issue.id,
    number: issue.number,
    title: issue.title,
    body: issue.body ?? "",
    url: issue.url,
  }
}

async function getRepositoryIssueByNumber(
  octokit: ReturnType<EngineerAiRuntime["getOctokit"]>,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<RepositoryIssue> {
  const result = await executeGraphqlWithFeatures<{
    repository: {
      issue: {
        id: string
        number: number
        title: string
        body: string | null
        url: string
      } | null
    } | null
  }>(
    octokit,
    `
      query($owner: String!, $name: String!, $number: Int!) {
        repository(owner: $owner, name: $name) {
          issue(number: $number) {
            id
            number
            title
            body
            url
          }
        }
      }
    `,
    {
      owner,
      name: repo,
      number: issueNumber,
    },
  )

  const issue = result.repository?.issue
  if (!issue) {
    throw new Error(`Issue "${owner}/${repo}#${issueNumber}" was not found in GitHub response`)
  }

  return {
    id: issue.id,
    number: issue.number,
    title: issue.title,
    body: issue.body ?? "",
    url: issue.url,
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
  const issue = await getRepositoryIssueByNumber(octokit, owner, repo, issueNumber)

  const updateResult = await executeGraphqlWithFeatures<{
    updateIssue: {
      issue: {
        id: string
        number: number
        title: string
        body: string | null
        url: string
      } | null
    } | null
  }>(
    octokit,
    `
      mutation($id: ID!, $title: String, $body: String, $state: IssueState) {
        updateIssue(input: { id: $id, title: $title, body: $body, state: $state }) {
          issue {
            id
            number
            title
            body
            url
          }
        }
      }
    `,
    {
      id: issue.id,
      title: updates.title,
      body: updates.body,
      state: updates.state,
    },
  )

  const updatedIssue = updateResult.updateIssue?.issue
  if (!updatedIssue) {
    throw new Error(`Issue "${owner}/${repo}#${issueNumber}" was not updated in GitHub response`)
  }

  return {
    id: updatedIssue.id,
    number: updatedIssue.number,
    title: updatedIssue.title,
    body: updatedIssue.body ?? "",
    url: updatedIssue.url,
  }
}

function executeGraphqlWithFeatures<TResponse>(
  octokit: ReturnType<EngineerAiRuntime["getOctokit"]>,
  query: string,
  variables?: Record<string, unknown>,
): Promise<TResponse> {
  return octokit.graphql<TResponse>(query, {
    ...variables,
    headers: {
      "GraphQL-Features": GRAPHQL_FEATURES_HEADER,
    },
  })
}

function registerRealtimeSessionLogs(
  session: CopilotSession,
  context: "planning" | "implementation",
  onProgressReported: (progressLine: string) => Promise<void>,
): () => void {
  const unsubscribers = [
    session.on("assistant.message", event => {
      logger.info(
        'engineer copilot assistant message context="%s" message_id="%s" content="%s"',
        context,
        event.data.messageId,
        event.data.content,
      )
    }),
    session.on("tool.execution_start", event => {
      logger.info(
        'engineer copilot tool execution started context="%s" tool_name="%s" tool_call_id="%s"',
        context,
        event.data.toolName,
        event.data.toolCallId,
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

async function updateProgressNotification(
  notificationService: NotificationServiceClient,
  notificationId: string,
  title: string,
  progressLine: string,
): Promise<void> {
  const content = [title, "", `> ${progressLine}`].join("\n")
  await notificationService.updateNotification({
    notificationId,
    title,
    content,
  })
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

async function runCommand(command: string[]): Promise<void> {
  const process = Bun.spawn(command, {
    stdout: "pipe",
    stderr: "pipe",
  })

  const exitCode = await process.exited
  if (exitCode === 0) {
    return
  }

  const stderr = await process.stderr.text()
  throw new Error(`Command failed: ${command.join(" ")} (${stderr.trim()})`)
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}
