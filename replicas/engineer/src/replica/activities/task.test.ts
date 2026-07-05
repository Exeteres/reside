import type { NotificationServiceClient } from "@reside/api/interaction/notification.v1"
import type { GenericOperationService, LanguageEngine } from "@reside/common"
import type { DeepMockProxy } from "@reside/common/testing"
import type { Operation, PrismaClient } from "../../database"
import type { GitHubService } from "../business"
import { describe, expect, test } from "bun:test"
import { mockDeepFn } from "@reside/common/testing"
import { createTaskActivities, parseGeneratedTaskPreviewTitle } from "./task"

type MockOctokit = {
  rest: {
    issues: {
      update: (input: unknown) => Promise<unknown>
    }
  }
}

describe("parseGeneratedTaskPreviewTitle", () => {
  test("parses valid title json", () => {
    expect(parseGeneratedTaskPreviewTitle('{"title":"Очистка контекста"}')).toEqual({
      title: "Очистка контекста",
    })
  })

  test("rejects plain text", () => {
    expect(() => parseGeneratedTaskPreviewTitle("Очистка контекста")).toThrow(
      "OpenAI title response is not valid JSON",
    )
  })

  test("rejects json without object shape", () => {
    expect(() => parseGeneratedTaskPreviewTitle('"Очистка контекста"')).toThrow()
  })
})

describe("requestCancellation", () => {
  test("marks running task as requested and closes linked issue", async () => {
    const { activities, prisma, octokit } = createFixture()
    let findUniqueCalls = 0

    prisma.task.findUnique.mockImplementation((async () => {
      findUniqueCalls += 1

      if (findUniqueCalls === 1) {
        return {
          id: 7,
          phase: "IMPLEMENTATION",
          status: "IN_PROGRESS",
          issueId: 55,
        }
      }

      return { issueId: 55 }
    }) as never)
    prisma.task.updateMany.mockResolvedValue({ count: 1 } as never)
    octokit.rest.issues.update.mockResolvedValue({ data: {} } as never)

    await activities.requestCancellation({ taskId: "7" })

    expect(prisma.task.updateMany.spy()).toHaveBeenCalledWith({
      where: {
        id: 7,
        status: "IN_PROGRESS",
      },
      data: {
        status: "REQUESTED_CANCELLATION",
      },
    })
    expect(octokit.rest.issues.update.spy()).toHaveBeenCalledWith({
      owner: "exeteres",
      repo: "reside4",
      issue_number: 55,
      state: "closed",
      state_reason: "not_planned",
    })
    expect(prisma.task.update.spy()).toHaveBeenCalledTimes(0)
  })

  test("closes linked issue when cancellation was already requested", async () => {
    const { activities, prisma, octokit } = createFixture()
    let findUniqueCalls = 0

    prisma.task.findUnique.mockImplementation((async () => {
      findUniqueCalls += 1

      if (findUniqueCalls === 1) {
        return {
          id: 7,
          phase: "IMPLEMENTATION",
          status: "REQUESTED_CANCELLATION",
          issueId: 55,
        }
      }

      return { issueId: 55 }
    }) as never)
    octokit.rest.issues.update.mockResolvedValue({ data: {} } as never)

    await activities.requestCancellation({ taskId: "7" })

    expect(prisma.task.updateMany.spy()).toHaveBeenCalledTimes(0)
    expect(prisma.task.update.spy()).toHaveBeenCalledTimes(0)
    expect(octokit.rest.issues.update.spy()).toHaveBeenCalledWith({
      owner: "exeteres",
      repo: "reside4",
      issue_number: 55,
      state: "closed",
      state_reason: "not_planned",
    })
  })
})

describe("startImplementationOnlyTask", () => {
  test("creates implementation task without issue", async () => {
    const { activities, prisma } = createFixture()

    prisma.task.create.mockResolvedValue({ id: 17 } as never)

    const result = await activities.startImplementationOnlyTask({
      subjectId: "replica:engineer",
      progressNotificationId: "notification-1",
      topicId: "topic-1",
      previewTitle: "Быстрая правка",
    })

    expect(result).toEqual({ taskId: "17" })
    expect(prisma.task.create.spy()).toHaveBeenCalledWith({
      data: {
        phase: "IMPLEMENTATION",
        status: "IN_PROGRESS",
        topicId: "topic-1",
        previewTitle: "Быстрая правка",
        progressNotificationId: "notification-1",
        createdBy: "replica:engineer",
      },
    })
  })
})

function createFixture(): {
  activities: ReturnType<typeof createTaskActivities>
  prisma: DeepMockProxy<PrismaClient>
  octokit: DeepMockProxy<MockOctokit>
} {
  const languageEngine = mockDeepFn<LanguageEngine>()
  const prisma = mockDeepFn<PrismaClient>()
  const notificationService = mockDeepFn<NotificationServiceClient>()
  const operationService = mockDeepFn<GenericOperationService<Operation>>()
  const octokit = mockDeepFn<MockOctokit>()
  const githubOctokit = { rest: octokit.rest } as never
  const github: GitHubService = {
    getOctokit: async () => githubOctokit,
    getRepositoryTarget: async () => ({
      owner: "exeteres",
      name: "reside4",
      cloneUrl: "https://github.com/exeteres/reside4.git",
    }),
    stop: async () => undefined,
  }
  const createFactoryEnvironment = async () => ({
    workingDirectory: "/factory/worktree",
    repositoryPath: "/factory/worktree",
    opencodeSessionId: "session-1",
    taskId: 1,
    branchName: "replica/task-1/1",
    dispose: async () => undefined,
  })

  return {
    activities: createTaskActivities({
      github,
      createFactoryEnvironment,
      languageEngine,
      prisma,
      notificationService,
      operationService,
    }),
    prisma,
    octokit,
  }
}
