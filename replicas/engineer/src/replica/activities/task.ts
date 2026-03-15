import type { CopilotClient, CopilotSession } from "@github/copilot-sdk"
import type { createServices } from "../../shared"
import type { EngineerAiRuntime } from "../ai-runtime"
import { defineTool } from "@github/copilot-sdk"
import { logger } from "@reside/common"
import { z } from "zod"
import { strings } from "../../locale"

type EngineerPrismaClient = Awaited<ReturnType<typeof createServices>>["prisma"]
type EngineerNotificationService = Awaited<
  ReturnType<typeof createServices>
>["interactionNotificationService"]

const issueDraftSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
})

const requiredIssueBodySections = [
  "## Контекст",
  "## Компоненты",
  "## Предлагаемые изменения",
  "## План реализации",
] as const

const ISSUE_BODY_TEMPLATE = [
  "## Контекст",
  "<кратко опиши проблему и текущее поведение>",
  "",
  "## Компоненты",
  "- **<название реплики>** (`replicas/<name>`) (изменить)",
  "- **<имя пакета>** (`packages/<name>`) (создать)",
  "- **<название компонента>** (`replicas/<name> | packages/<name>`) (удалить)",
  "",
  "## Предлагаемые изменения",
  "- <изменение 1>",
  "- <изменение 2>",
  "",
  "## План реализации",
  "1. <шаг 1>",
  "2. <шаг 2>",
  "3. <шаг 3>",
].join("\n")

const ALLOWED_SESSION_TOOLS = new Set([
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
])
const COPILOT_ASSIGNEE_ACTOR_ID = "BOT_kgDOC9w8XQ"
const COPILOT_SESSION_TIMEOUT_MS = 10 * 60 * 1000
const GRAPHQL_FEATURES_HEADER = "issues_copilot_assignment_api_support"

const createTaskResultSchema = z.object({
  taskId: z.string().min(1),
  issueTitle: z.string().min(1),
  issueUrl: z.string().url(),
  repositoryUrl: z.string().url(),
})

type TaskSessionState = {
  dbTaskId?: number
  taskId: string
  owner: string
  repo: string
  issueNumber: number
  issueUrl: string
  repositoryUrl: string
  issueTitle: string
  issueBody: string
  progressHistory: string[]
  session?: CopilotSession
}

type PendingTaskDraftState = {
  draftId: string
  taskId: string
  dbTaskId: number
  owner: string
  repo: string
  repositoryUrl: string
  progressHistory: string[]
  session: CopilotSession
}

const analyzeTaskInputSchema = z.object({
  subjectId: z.string().min(1),
  task: z.string().min(1),
  progressNotificationId: z.string().min(1),
})

const analyzeTaskResultSchema = z.object({
  draftId: z.string().min(1),
  taskId: z.string().min(1),
  issueTitle: z.string().min(1),
  issueBody: z.string().min(1),
})

const createTaskFromDraftInputSchema = z.object({
  draftId: z.string().min(1),
  taskId: z.string().min(1),
  issueTitle: z.string().min(1),
  issueBody: z.string().min(1),
})

const analyzeTaskFeedbackInputSchema = z.object({
  taskId: z.string().min(1),
  feedback: z.string().min(1),
  progressNotificationId: z.string().min(1),
})

const analyzeTaskFeedbackResultSchema = z.object({
  issueTitle: z.string().min(1),
  issueBody: z.string().min(1),
})

const applyTaskFeedbackInputSchema = z.object({
  taskId: z.string().min(1),
  feedback: z.string().min(1),
  issueTitle: z.string().min(1),
  issueBody: z.string().min(1),
})

type CreateTaskResult = z.infer<typeof createTaskResultSchema>
type AnalyzeTaskForIssueInput = z.infer<typeof analyzeTaskInputSchema>
type CreateTaskFromDraftInput = z.infer<typeof createTaskFromDraftInputSchema>
type AnalyzeTaskFeedbackInput = z.infer<typeof analyzeTaskFeedbackInputSchema>
type AnalyzeTaskFeedbackResult = z.infer<typeof analyzeTaskFeedbackResultSchema>
type ApplyTaskFeedbackInput = z.infer<typeof applyTaskFeedbackInputSchema>
type IssueDraft = z.infer<typeof issueDraftSchema>
type SessionDraftState = {
  submittedDraft?: IssueDraft
}

export function createCreateTaskActivities(
  runtime: EngineerAiRuntime,
  prisma: EngineerPrismaClient,
  notificationService: EngineerNotificationService,
) {
  const pendingTaskDrafts = new Map<string, PendingTaskDraftState>()
  const taskSessions = new Map<string, TaskSessionState>()
  const draftStatesBySessionId = new Map<string, SessionDraftState>()

  return {
    analyzeTaskForIssue: async (input: AnalyzeTaskForIssueInput) => {
      const parsedInput = analyzeTaskInputSchema.parse(input)
      const copilotClient = runtime.getCopilotClient()
      const repository = await runtime.getRepositoryTarget()

      const repositoryUrl = `https://github.com/${repository.owner}/${repository.name}`
      const taskEntity = await prisma.task.create({
        data: {
          subjectId: parsedInput.subjectId,
        },
      })

      await prisma.taskPrompt.create({
        data: {
          taskId: taskEntity.id,
          prompt: parsedInput.task,
        },
      })

      const taskId = String(taskEntity.id)
      const draftId = crypto.randomUUID()
      let session: CopilotSession | undefined

      try {
        session = await createTaskSession(
          copilotClient,
          repository.localPath,
          draftStatesBySessionId,
        )

        const issueDraft = await requestIssueDraftFromSession(
          session,
          draftStatesBySessionId,
          [
            `You are preparing a GitHub issue for repository ${repository.owner}/${repository.name}.`,
            "Analyze the user request in the context of the current codebase from working directory.",
            "Keep implementation depth moderate: realistic but not overly detailed.",
            "",
            "The body must include these sections in plain markdown:",
            "1) Контекст",
            "2) Компоненты",
            "3) Предлагаемые изменения",
            "4) План реализации (3-6 шагов)",
            "",
            `User prompt: ${parsedInput.task}`,
          ].join("\n"),
          "create-task",
          parsedInput.progressNotificationId,
          [],
          notificationService,
        )

        const progressHistory = readProgressHistory(session)

        pendingTaskDrafts.set(draftId, {
          draftId,
          taskId,
          dbTaskId: taskEntity.id,
          owner: repository.owner,
          repo: repository.name,
          repositoryUrl,
          progressHistory,
          session,
        })

        return analyzeTaskResultSchema.parse({
          draftId,
          taskId,
          issueTitle: issueDraft.title,
          issueBody: issueDraft.body,
        })
      } catch (error) {
        if (session) {
          await session.disconnect()
        }

        pendingTaskDrafts.delete(draftId)
        taskSessions.delete(taskId)

        await prisma.task.delete({
          where: {
            id: taskEntity.id,
          },
        })

        throw error
      }
    },

    createTaskFromDraft: async (input: CreateTaskFromDraftInput): Promise<CreateTaskResult> => {
      const parsedInput = createTaskFromDraftInputSchema.parse(input)
      const draftState = mustGetPendingTaskDraft(pendingTaskDrafts, parsedInput.draftId)
      const octokit = runtime.getOctokit()

      if (draftState.taskId !== parsedInput.taskId) {
        throw new Error(`Draft "${parsedInput.draftId}" task mismatch`)
      }

      try {
        const issue = await createIssueWithoutAssignee(
          octokit,
          draftState.owner,
          draftState.repo,
          parsedInput.issueTitle,
          parsedInput.issueBody,
        )

        const issueNumber = issue.number
        const issueUrl = issue.url

        if (!issueNumber || !issueUrl) {
          throw new Error("GitHub issue response is missing issue number or url")
        }

        await prisma.task.update({
          where: {
            id: draftState.dbTaskId,
          },
          data: {
            issueId: issueNumber,
          },
        })

        taskSessions.set(draftState.taskId, {
          dbTaskId: draftState.dbTaskId,
          taskId: draftState.taskId,
          owner: draftState.owner,
          repo: draftState.repo,
          issueNumber,
          issueUrl,
          repositoryUrl: draftState.repositoryUrl,
          issueTitle: parsedInput.issueTitle,
          issueBody: parsedInput.issueBody,
          progressHistory: draftState.progressHistory,
          session: draftState.session,
        })

        pendingTaskDrafts.delete(parsedInput.draftId)

        logger.info(
          {
            owner: draftState.owner,
            repo: draftState.repo,
            issueNumber,
            issueUrl,
            taskId: draftState.taskId,
          },
          "engineer create_task created github issue",
        )

        return createTaskResultSchema.parse({
          taskId: draftState.taskId,
          issueTitle: parsedInput.issueTitle,
          issueUrl,
          repositoryUrl: draftState.repositoryUrl,
        })
      } catch (error) {
        pendingTaskDrafts.delete(parsedInput.draftId)
        await draftState.session.disconnect()
        throw error
      }
    },

    analyzeTaskFeedback: async (
      input: AnalyzeTaskFeedbackInput,
    ): Promise<AnalyzeTaskFeedbackResult> => {
      const parsedInput = analyzeTaskFeedbackInputSchema.parse(input)
      const repository = await runtime.getRepositoryTarget()
      const octokit = runtime.getOctokit()
      let taskState = await resolveTaskState(
        taskSessions,
        prisma,
        octokit,
        repository,
        parsedInput.taskId,
      )

      let session = taskState.session

      if (!session) {
        const fallbackSession = await createTaskSession(
          runtime.getCopilotClient(),
          repository.localPath,
          draftStatesBySessionId,
        )

        session = fallbackSession

        taskState = {
          ...taskState,
          session,
        }

        taskSessions.set(parsedInput.taskId, taskState)
      }

      const issueDraft = await requestIssueDraftFromSession(
        session,
        draftStatesBySessionId,
        [
          "User provided feedback for existing GitHub issue draft.",
          "Update title and body accordingly.",
          "",
          `Current title: ${taskState.issueTitle}`,
          "Current body:",
          taskState.issueBody,
          "",
          `Feedback: ${parsedInput.feedback}`,
        ].join("\n"),
        "update-task",
        parsedInput.progressNotificationId,
        taskState.progressHistory,
        notificationService,
      )

      const progressHistory = readProgressHistory(session)

      taskSessions.set(parsedInput.taskId, {
        ...taskState,
        progressHistory,
      })

      return analyzeTaskFeedbackResultSchema.parse({
        issueTitle: issueDraft.title,
        issueBody: issueDraft.body,
      })
    },

    applyTaskFeedback: async (input: ApplyTaskFeedbackInput): Promise<CreateTaskResult> => {
      const parsedInput = applyTaskFeedbackInputSchema.parse(input)
      const repository = await runtime.getRepositoryTarget()
      const octokit = runtime.getOctokit()
      const taskState = await resolveTaskState(
        taskSessions,
        prisma,
        octokit,
        repository,
        parsedInput.taskId,
      )

      const updatedIssue = await updateRepositoryIssue(
        octokit,
        taskState.owner,
        taskState.repo,
        taskState.issueNumber,
        {
          title: parsedInput.issueTitle,
          body: parsedInput.issueBody,
        },
      )

      const issueUrl = updatedIssue.url ?? taskState.issueUrl

      if (taskState.dbTaskId) {
        await prisma.taskPrompt.create({
          data: {
            taskId: taskState.dbTaskId,
            prompt: parsedInput.feedback,
          },
        })
      } else {
        logger.warn(
          {
            taskId: parsedInput.taskId,
          },
          "engineer apply_task_feedback skipped task prompt persistence because task was not found in database",
        )
      }

      const progressHistory = taskState.session
        ? readProgressHistory(taskState.session)
        : taskState.progressHistory

      const updatedState: TaskSessionState = {
        ...taskState,
        issueTitle: parsedInput.issueTitle,
        issueBody: parsedInput.issueBody,
        issueUrl,
        progressHistory,
      }

      taskSessions.set(parsedInput.taskId, updatedState)

      return createTaskResultSchema.parse({
        taskId: updatedState.taskId,
        issueTitle: updatedState.issueTitle,
        issueUrl: updatedState.issueUrl,
        repositoryUrl: updatedState.repositoryUrl,
      })
    },

    confirmTask: async (taskId: string): Promise<void> => {
      const repository = await runtime.getRepositoryTarget()
      const octokit = runtime.getOctokit()
      const taskState = await resolveTaskState(taskSessions, prisma, octokit, repository, taskId)

      await assignIssueToCopilotIfAvailable(
        octokit,
        taskState.owner,
        taskState.repo,
        taskState.issueNumber,
      )

      if (taskState?.session) {
        await taskState.session.disconnect()
      }

      taskSessions.delete(taskId)
    },

    closeTask: async (taskId: string): Promise<void> => {
      const repository = await runtime.getRepositoryTarget()
      const octokit = runtime.getOctokit()
      const taskState = await resolveTaskState(taskSessions, prisma, octokit, repository, taskId)

      await updateRepositoryIssue(octokit, taskState.owner, taskState.repo, taskState.issueNumber, {
        state: "CLOSED",
      })

      if (taskState?.session) {
        await taskState.session.disconnect()
      }

      taskSessions.delete(taskId)
    },
  }
}

function mustGetPendingTaskDraft(
  pendingTaskDrafts: Map<string, PendingTaskDraftState>,
  draftId: string,
): PendingTaskDraftState {
  const draftState = pendingTaskDrafts.get(draftId)
  if (!draftState) {
    throw new Error(`Unknown pending task draft "${draftId}"`)
  }

  return draftState
}

async function resolveTaskState(
  taskSessions: Map<string, TaskSessionState>,
  prisma: EngineerPrismaClient,
  octokit: ReturnType<EngineerAiRuntime["getOctokit"]>,
  repository: Awaited<ReturnType<EngineerAiRuntime["getRepositoryTarget"]>>,
  taskId: string,
): Promise<TaskSessionState> {
  const inMemoryState = taskSessions.get(taskId)
  if (inMemoryState) {
    return inMemoryState
  }

  const dbTaskId = parseDbTaskId(taskId)
  const taskEntity = await prisma.task.findUnique({
    where: {
      id: dbTaskId,
    },
    select: {
      id: true,
      issueId: true,
    },
  })

  if (!taskEntity) {
    throw new Error(`Unknown task "${taskId}"`)
  }

  if (!taskEntity.issueId) {
    throw new Error(`Task "${taskId}" is not linked to GitHub issue yet`)
  }

  const repositoryUrl = `https://github.com/${repository.owner}/${repository.name}`
  const issue = await getRepositoryIssueByNumber(
    octokit,
    repository.owner,
    repository.name,
    taskEntity.issueId,
  )

  const issueTitle = issue.title
  if (!issueTitle) {
    throw new Error(`Issue "${taskId}" is missing title in GitHub response`)
  }

  const recoveredTaskState: TaskSessionState = {
    dbTaskId: taskEntity.id,
    taskId,
    owner: repository.owner,
    repo: repository.name,
    issueNumber: taskEntity.issueId,
    issueUrl: issue.url ?? `${repositoryUrl}/issues/${taskEntity.issueId}`,
    repositoryUrl,
    issueTitle,
    issueBody: issue.body ?? "",
    progressHistory: [],
  }

  taskSessions.set(taskId, recoveredTaskState)

  logger.info(
    {
      taskId,
      dbTaskId: taskEntity.id,
    },
    "engineer restored task state without in-memory session",
  )

  return recoveredTaskState
}

function parseDbTaskId(taskId: string): number {
  const parsedTaskId = Number.parseInt(taskId, 10)
  if (!Number.isInteger(parsedTaskId) || parsedTaskId <= 0) {
    throw new Error(`Invalid task id format "${taskId}"`)
  }

  return parsedTaskId
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

async function assignIssueToCopilotIfAvailable(
  octokit: ReturnType<EngineerAiRuntime["getOctokit"]>,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<void> {
  const issue = await getRepositoryIssueByNumber(octokit, owner, repo, issueNumber)
  try {
    await executeGraphqlWithFeatures(
      octokit,
      `
        mutation($issueId: ID!, $assigneeIds: [ID!]!) {
          addAssigneesToAssignable(
            input: {
              assignableId: $issueId
              assigneeIds: $assigneeIds
            }
          ) {
            assignable {
              __typename
            }
          }
        }
      `,
      {
        issueId: issue.id,
        assigneeIds: [COPILOT_ASSIGNEE_ACTOR_ID],
      },
    )
  } catch (error) {
    throw new Error(`Failed to assign Copilot for "${owner}/${repo}#${issueNumber}"`, {
      cause: error,
    })
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

function createTaskSession(
  copilotClient: CopilotClient,
  workingDirectory: string,
  draftStatesBySessionId: Map<string, SessionDraftState>,
): Promise<CopilotSession> {
  return copilotClient.createSession({
    model: "gpt-5.3-codex",
    workingDirectory,
    onPermissionRequest: async () => ({ kind: "approved" }),
    tools: [createSubmitIssueDraftTool(draftStatesBySessionId)],
    hooks: {
      onPreToolUse: async toolInvocation => {
        if (ALLOWED_SESSION_TOOLS.has(toolInvocation.toolName)) {
          return {
            permissionDecision: "allow",
          }
        }

        logger.warn(
          {
            toolName: toolInvocation.toolName,
          },
          "engineer copilot session denied tool use",
        )

        return {
          permissionDecision: "deny",
          permissionDecisionReason:
            'Only tools "report_intent" and "submit_issue_draft" are allowed for engineer task analysis',
        }
      },
    },
  })
}

async function requestIssueDraftFromSession(
  session: CopilotSession,
  draftStatesBySessionId: Map<string, SessionDraftState>,
  prompt: string,
  context: "create-task" | "update-task",
  progressNotificationId: string,
  initialProgressHistory: string[],
  notificationService: EngineerNotificationService,
): Promise<z.infer<typeof issueDraftSchema>> {
  const draftState = getSessionDraftState(draftStatesBySessionId, session.sessionId)
  draftState.submittedDraft = undefined
  const progressHistory = [...initialProgressHistory]

  setProgressHistory(session, progressHistory)

  const unsubscribeRealtimeLogs = registerRealtimeSessionLogs(
    session,
    context,
    async progressLine => {
      const normalizedProgressLine = normalizeProgressLine(progressLine)
      if (!normalizedProgressLine) {
        return
      }

      progressHistory.push(normalizedProgressLine)
      setProgressHistory(session, progressHistory)

      await updateProgressNotification(
        notificationService,
        progressNotificationId,
        context,
        progressHistory,
      )
    },
  )

  try {
    const finalAssistantMessage = await session.sendAndWait(
      {
        prompt: [
          prompt,
          "",
          'You MUST submit the final result by calling tool "submit_issue_draft" exactly once.',
          "Do not output JSON in assistant text.",
          "",
          "Issue body MUST follow this exact section template:",
          ISSUE_BODY_TEMPLATE,
          "",
          'Section "Компоненты" MUST include every affected package/replica.',
          "Each component line MUST end with exactly one operation suffix: (создать), (изменить), or (удалить).",
          "Component line format is strict: - **<display name>** (`replicas/<name>`|`packages/<name>`) (операция).",
          "Replica example: - **Авторизационная Реплика** (`replicas/access`) (изменить).",
          "Package example: - **@reside/common** (`packages/common`) (изменить).",
          "For each replica component, resolve human-readable title explicitly before writing the line:",
          "1) Open replicas/<replica>/src/bootstrap/main.ts and locate strings.bootstrap.registration.title.",
          "2) Open replicas/<replica>/src/locale/ru.ts and read strings.bootstrap.registration.title value.",
          "3) Use this exact russian title in component text, and keep path in the same line for traceability.",
          "If title cannot be resolved, use replica path only and mark with (изменить) unless operation is clearly different.",
          "If replica is subject to be created, define its proposed title and path based on existing replicas naming and user request, and mark with (создать).",
          "When creating new replicas, don't create extra packages for their logic unless requested by the user or clearly required by the implementation.",
          "Use one bullet per component and keep paths repository-relative.",
          "",
          "Implementation plan must have 3-6 numbered steps.",
          "",
          'Use built-in tool "report_intent" to report progress while analyzing.',
          'After analysis is done, call "submit_issue_draft" immediately.',
          "Use only read-only tools for repository inspection and never call bash.",
          "Each progress report must be one short sentence in russian lowercase.",
          "Do not end progress sentence with punctuation.",
        ].join("\n"),
      },
      COPILOT_SESSION_TIMEOUT_MS,
    )

    if (finalAssistantMessage?.data.content) {
      logger.info(
        {
          context,
          messageId: finalAssistantMessage.data.messageId,
          content: finalAssistantMessage.data.content,
        },
        "engineer copilot final assistant message",
      )
    }
  } finally {
    unsubscribeRealtimeLogs()
  }

  if (!draftState.submittedDraft) {
    throw new Error("Copilot did not submit issue draft via tool")
  }

  return draftState.submittedDraft
}

function createSubmitIssueDraftTool(draftStatesBySessionId: Map<string, SessionDraftState>) {
  return defineTool("submit_issue_draft", {
    description: "Submit final GitHub issue draft title and body",
    parameters: issueDraftSchema,
    handler: async (_args, context) => {
      const parsedDraft = issueDraftSchema.parse(_args)
      validateIssueBodyTemplate(parsedDraft.body)

      const draftState = getSessionDraftState(draftStatesBySessionId, context.sessionId)
      draftState.submittedDraft = parsedDraft

      return "Issue draft accepted"
    },
  })
}

function getSessionDraftState(
  draftStatesBySessionId: Map<string, SessionDraftState>,
  sessionId: string,
): SessionDraftState {
  let draftState = draftStatesBySessionId.get(sessionId)
  if (!draftState) {
    draftState = {}
    draftStatesBySessionId.set(sessionId, draftState)
  }

  return draftState
}

function registerRealtimeSessionLogs(
  session: CopilotSession,
  context: "create-task" | "update-task",
  onProgressReported: (progressLine: string) => Promise<void>,
): () => void {
  const unsubscribers = [
    session.on("assistant.message_delta", event => {
      logger.info(
        {
          context,
          messageId: event.data.messageId,
          delta: event.data.deltaContent,
        },
        "engineer copilot assistant message delta",
      )
    }),

    session.on("assistant.message", event => {
      logger.info(
        {
          context,
          messageId: event.data.messageId,
          content: event.data.content,
        },
        "engineer copilot assistant message",
      )
    }),

    session.on("tool.execution_start", event => {
      logger.info(
        {
          context,
          toolCallId: event.data.toolCallId,
          toolName: event.data.toolName,
          arguments: event.data.arguments,
        },
        "engineer copilot tool execution started",
      )

      if (event.data.toolName === "report_intent") {
        void onProgressReported(extractReportIntentProgress(event.data.arguments)).catch(error => {
          logger.warn(
            {
              context,
              error: error instanceof Error ? error.message : String(error),
            },
            "engineer copilot progress update failed",
          )
        })
      }
    }),

    session.on("tool.execution_progress", event => {
      logger.info(
        {
          context,
          toolCallId: event.data.toolCallId,
          progress: event.data.progressMessage,
        },
        "engineer copilot tool execution progress",
      )
    }),

    session.on("tool.execution_partial_result", event => {
      logger.info(
        {
          context,
          toolCallId: event.data.toolCallId,
          partialOutput: event.data.partialOutput,
        },
        "engineer copilot tool execution partial result",
      )
    }),

    session.on("tool.execution_complete", event => {
      logger.info(
        {
          context,
          toolCallId: event.data.toolCallId,
          success: event.data.success,
          result: event.data.result?.content,
        },
        "engineer copilot tool execution completed",
      )
    }),

    session.on("session.error", event => {
      logger.error(
        {
          context,
          errorType: event.data.errorType,
          message: event.data.message,
          statusCode: event.data.statusCode,
        },
        "engineer copilot session error",
      )
    }),
  ]

  return () => {
    for (const unsubscribe of unsubscribers) {
      unsubscribe()
    }
  }
}

async function updateProgressNotification(
  notificationService: EngineerNotificationService,
  notificationId: string,
  context: "create-task" | "update-task",
  progressHistory: string[],
): Promise<void> {
  const list = progressHistory
    .slice(-5)
    .map(item => `> ${item}`)
    .join("\n")

  const content = [
    context === "create-task"
      ? strings.notifications.taskAnalysis.creating
      : strings.notifications.taskAnalysis.updating,
    "",
    list,
  ].join("\n")

  await notificationService.updateNotification({
    notificationId,
    title: strings.notifications.taskAnalysis.title,
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
  const withoutEndingPunctuation = lowercase.replace(/[.!?,:;…]+$/g, "")
  const shortSentence = withoutEndingPunctuation.slice(0, 100).trim()

  if (!shortSentence) {
    return undefined
  }

  return shortSentence
}

function setProgressHistory(session: CopilotSession, progressHistory: string[]): void {
  const sessionWithProgress = session as CopilotSession & {
    __engineerProgressHistory?: string[]
  }

  sessionWithProgress.__engineerProgressHistory = [...progressHistory]
}

function readProgressHistory(session: CopilotSession): string[] {
  const sessionWithProgress = session as CopilotSession & {
    __engineerProgressHistory?: string[]
  }

  return [...(sessionWithProgress.__engineerProgressHistory ?? [])]
}

function validateIssueBodyTemplate(body: string): void {
  let sectionOffset = 0

  for (const section of requiredIssueBodySections) {
    const index = body.indexOf(section, sectionOffset)
    if (index < 0) {
      throw new Error(`Issue body does not contain required section: ${section}`)
    }

    sectionOffset = index + section.length
  }

  const componentsMatch = body.match(/## Компоненты([\s\S]*?)(## Предлагаемые изменения|$)/)
  const componentsSection = componentsMatch?.[1] ?? ""
  const componentLines = componentsSection
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0)

  if (componentLines.length === 0) {
    throw new Error("Issue body section Компоненты must include at least one component")
  }

  const componentLinePattern =
    /^-\s+\*\*.+\*\*\s+\(`(replicas\/[a-z0-9-]+|packages\/[a-z0-9-]+)`\)\s+\((создать|изменить|удалить)\)$/
  for (const line of componentLines) {
    if (!componentLinePattern.test(line)) {
      throw new Error(
        "Issue body section Компоненты has invalid line format; expected '- **<название>** (`replicas/<name>`|`packages/<name>`) (создать|изменить|удалить)'",
      )
    }
  }

  const planMatch = body.match(/## План реализации([\s\S]*?)$/)
  const planSection = planMatch?.[1] ?? ""
  const steps = planSection.match(/^\d+\.\s.+$/gm) ?? []

  if (steps.length < 3 || steps.length > 6) {
    throw new Error("Issue body implementation plan must have 3-6 numbered steps")
  }
}
