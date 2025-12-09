import type { GitHubData } from "./contract"
import { co } from "jazz-tools"
import { Issue } from "./issue"
import { PullRequest } from "./pull-request"

const ObjectBox = co.map({
  issue: Issue.optional(),
  pullRequest: PullRequest.optional(),
})

export type Object =
  | {
      type: "issue"
      data: Issue
    }
  | {
      type: "pull-request"
      data: PullRequest
    }

/**
 * Gets an object (issue or pull request) by its unique identifier.
 *
 * @param data The GitHub contract data.
 * @param repositoryId The unique identifier of the repository.
 * @param id The unique identifier of the object.
 * @returns The issue or pull request if found, otherwise null.
 */
export async function getObjectById(
  data: GitHubData,
  repositoryId: number,
  id: number,
): Promise<Object | null> {
  const box = await ObjectBox.loadUnique(
    //
    `object.by-id.${repositoryId}.${id}`,
    data.$jazz.owner.$jazz.id,
    {
      loadAs: data.$jazz.loadedAs,
      resolve: { issue: true, pullRequest: true },
    },
  )

  if (!box.$isLoaded) {
    return null
  }

  if (box.issue) {
    return { type: "issue", data: box.issue }
  }

  if (box.pullRequest) {
    return { type: "pull-request", data: box.pullRequest }
  }

  return null
}

/**
 * Gets an issue by its unique identifier.
 * Throws if the object with the given ID is not an issue.
 *
 * @param data The GitHub contract data.
 * @param repositoryId The unique identifier of the repository.
 * @param id The unique identifier of the issue.
 * @returns The issue if found, otherwise null.
 */
export async function getIssueById(
  data: GitHubData,
  repositoryId: number,
  id: number,
): Promise<Issue | null> {
  const object = await getObjectById(data, repositoryId, id)

  if (object && object.type !== "issue") {
    throw new Error(`Object with ID ${id} is not an issue: found type ${object.type}`)
  }

  return object ? object.data : null
}

/**
 * Gets a pull request by its unique identifier.
 * Throws if the object with the given ID is not a pull request.
 *
 * @param data The GitHub contract data.
 * @param repositoryId The unique identifier of the repository.
 * @param id The unique identifier of the pull request.
 * @returns The pull request if found, otherwise null.
 */
export async function getPullRequestById(
  data: GitHubData,
  repositoryId: number,
  id: number,
): Promise<PullRequest | null> {
  const object = await getObjectById(data, repositoryId, id)

  if (object && object.type !== "pull-request") {
    throw new Error(`Object with ID ${id} is not a pull request: found type ${object.type}`)
  }

  return object ? object.data : null
}
