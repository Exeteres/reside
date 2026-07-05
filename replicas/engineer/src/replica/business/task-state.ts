import type { Octokit } from "octokit"
import type { PrismaClient } from "../../database"
import type { GitHubService } from "./github"

export type RepositoryIssue = {
  id: string
  number: number
  title: string
  body: string
  url: string
}

export type RepositoryIssueState = "OPEN" | "CLOSED"
export type RepositoryIssueStateReason = "COMPLETED" | "NOT_PLANNED"

export async function upsertTaskIssue(
  prisma: PrismaClient,
  github: GitHubService,
  taskId: number,
  owner: string,
  repo: string,
  issueTitle: string,
  issueBody: string,
): Promise<RepositoryIssue> {
  const octokit = await github.getOctokit()
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

  return await updateRepositoryIssue(octokit, owner, repo, task.issueId, issueTitle, issueBody)
}

export async function createIssueWithoutAssignee(
  octokit: Octokit,
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

export async function getRepositoryIssueByNumber(
  octokit: Octokit,
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

export async function updateRepositoryIssue(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  title: string | undefined,
  body: string | undefined,
  state?: RepositoryIssueState,
): Promise<RepositoryIssue> {
  const updatedIssue = await octokit.rest.issues.update({
    owner,
    repo,
    issue_number: issueNumber,
    title,
    body,
    state: state?.toLowerCase() as "open" | "closed" | undefined,
  })

  return {
    id: String(updatedIssue.data.id),
    number: updatedIssue.data.number,
    title: updatedIssue.data.title,
    body: updatedIssue.data.body ?? "",
    url: updatedIssue.data.html_url,
  }
}

export async function syncTaskIssueState(
  prisma: PrismaClient,
  github: GitHubService,
  taskId: number,
  state: RepositoryIssueState,
  stateReason?: RepositoryIssueStateReason,
): Promise<void> {
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

  const repository = await github.getRepositoryTarget()
  await updateRepositoryIssueState(
    await github.getOctokit(),
    repository.owner,
    repository.name,
    task.issueId,
    state,
    stateReason,
  )
}

export async function updateRepositoryIssueState(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  state: RepositoryIssueState,
  stateReason?: RepositoryIssueStateReason,
): Promise<void> {
  await octokit.rest.issues.update({
    owner,
    repo,
    issue_number: issueNumber,
    state: state.toLowerCase() as "open" | "closed",
    state_reason: state === "CLOSED" && stateReason ? mapIssueStateReason(stateReason) : undefined,
  })
}

export function mapIssueStateReason(
  reason: RepositoryIssueStateReason,
): "completed" | "not_planned" {
  return reason === "COMPLETED" ? "completed" : "not_planned"
}

export async function getNextIterationNumber(
  prisma: PrismaClient,
  taskId: number,
): Promise<number> {
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

export function parseDbTaskId(taskId: string): number {
  const parsedTaskId = Number.parseInt(taskId, 10)
  if (!Number.isInteger(parsedTaskId) || parsedTaskId <= 0) {
    throw new Error(`Invalid task id format "${taskId}"`)
  }

  return parsedTaskId
}

export async function isTaskCancellationRequested(
  prisma: PrismaClient,
  taskId: number,
): Promise<boolean> {
  const task = await prisma.task.findUnique({
    where: {
      id: taskId,
    },
    select: {
      status: true,
    },
  })

  return task?.status === "REQUESTED_CANCELLATION"
}
