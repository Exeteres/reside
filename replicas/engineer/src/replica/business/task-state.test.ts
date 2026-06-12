import type { PrismaClient } from "../../database"
import type { EngineerAiRuntime } from "./ai-runtime"
import { describe, expect, test } from "bun:test"
import { type DeepMockProxy, mockDeepFn } from "@reside/common/testing"
import {
  getNextIterationNumber,
  isTaskCancellationRequested,
  mapIssueStateReason,
  parseDbTaskId,
  syncTaskIssueState,
  upsertTaskIssue,
} from "./task-state"

type MockOctokit = {
  rest: {
    issues: {
      create: (input: unknown) => Promise<unknown>
      update: (input: unknown) => Promise<unknown>
    }
  }
}

describe("parseDbTaskId", () => {
  test("parses positive integer task id", () => {
    expect(parseDbTaskId("42")).toBe(42)
  })

  test("rejects invalid task id", () => {
    expect(() => parseDbTaskId("0")).toThrow('Invalid task id format "0"')
    expect(() => parseDbTaskId("task-1")).toThrow('Invalid task id format "task-1"')
  })
})

describe("getNextIterationNumber", () => {
  test("increments latest iteration", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    prisma.taskIteration.aggregate.mockResolvedValue({
      _max: {
        iteration: 3,
      },
    } as never)

    await expect(getNextIterationNumber(prisma, 7)).resolves.toBe(4)
    expect(prisma.taskIteration.aggregate.spy()).toHaveBeenCalledWith({
      where: {
        taskId: 7,
      },
      _max: {
        iteration: true,
      },
    })
  })
})

describe("isTaskCancellationRequested", () => {
  test("returns true only for requested cancellation state", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    prisma.task.findUnique.mockResolvedValue({
      status: "REQUESTED_CANCELLATION",
    } as never)

    await expect(isTaskCancellationRequested(prisma, 7)).resolves.toBe(true)
  })

  test("returns false when task is missing", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    prisma.task.findUnique.mockResolvedValue(null as never)

    await expect(isTaskCancellationRequested(prisma, 7)).resolves.toBe(false)
  })
})

describe("upsertTaskIssue", () => {
  test("creates repository issue and stores issue number when task has no issue", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const { runtime, octokit } = createFixture()
    prisma.task.findUnique.mockResolvedValue({ issueId: null } as never)
    octokit.rest.issues.create.mockResolvedValue({
      data: {
        id: 1001,
        number: 55,
        title: "План",
        body: null,
        html_url: "https://github.com/exeteres/reside4/issues/55",
      },
    } as never)

    const issue = await upsertTaskIssue(
      prisma,
      runtime,
      7,
      "exeteres",
      "reside4",
      "План",
      "Описание",
    )

    expect(octokit.rest.issues.create.spy()).toHaveBeenCalledWith({
      owner: "exeteres",
      repo: "reside4",
      title: "План",
      body: "Описание",
    })
    expect(prisma.task.update.spy()).toHaveBeenCalledWith({
      where: {
        id: 7,
      },
      data: {
        issueId: 55,
      },
    })
    expect(issue.number).toBe(55)
    expect(issue.body).toBe("")
  })

  test("updates existing repository issue", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const { runtime, octokit } = createFixture()
    prisma.task.findUnique.mockResolvedValue({ issueId: 55 } as never)
    octokit.rest.issues.update.mockResolvedValue({
      data: {
        id: 1001,
        number: 55,
        title: "Новый план",
        body: "Описание",
        html_url: "https://github.com/exeteres/reside4/issues/55",
      },
    } as never)

    const issue = await upsertTaskIssue(
      prisma,
      runtime,
      7,
      "exeteres",
      "reside4",
      "Новый план",
      "Описание",
    )

    expect(octokit.rest.issues.update.spy()).toHaveBeenCalledWith({
      owner: "exeteres",
      repo: "reside4",
      issue_number: 55,
      title: "Новый план",
      body: "Описание",
      state: undefined,
    })
    expect(issue.title).toBe("Новый план")
  })
})

describe("syncTaskIssueState", () => {
  test("does nothing when task has no issue", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const { runtime, octokit } = createFixture()
    prisma.task.findUnique.mockResolvedValue({ issueId: null } as never)

    await syncTaskIssueState(prisma, runtime, 7, "CLOSED", "NOT_PLANNED")

    expect(octokit.rest.issues.update.spy()).not.toHaveBeenCalled()
  })

  test("updates repository issue state with mapped reason", async () => {
    const prisma = mockDeepFn<PrismaClient>()
    const { runtime, octokit } = createFixture()
    prisma.task.findUnique.mockResolvedValue({ issueId: 55 } as never)

    await syncTaskIssueState(prisma, runtime, 7, "CLOSED", "COMPLETED")

    expect(octokit.rest.issues.update.spy()).toHaveBeenCalledWith({
      owner: "exeteres",
      repo: "reside4",
      issue_number: 55,
      state: "closed",
      state_reason: "completed",
    })
  })
})

describe("mapIssueStateReason", () => {
  test("maps repository state reasons", () => {
    expect(mapIssueStateReason("COMPLETED")).toBe("completed")
    expect(mapIssueStateReason("NOT_PLANNED")).toBe("not_planned")
  })
})

function createFixture(): {
  runtime: EngineerAiRuntime
  octokit: DeepMockProxy<MockOctokit>
} {
  const runtime = mockDeepFn<EngineerAiRuntime>()
  const octokit = mockDeepFn<MockOctokit>()
  runtime.getOctokit.mockReturnValue(octokit as never)
  runtime.getRepositoryTarget.mockResolvedValue({
    owner: "exeteres",
    name: "reside4",
    cloneUrl: "https://github.com/exeteres/reside4.git",
  })

  return {
    runtime,
    octokit,
  }
}
