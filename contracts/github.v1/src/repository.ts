import type { GitHubData } from "./contract"
import { box, loadBoxed } from "@reside/shared"
import { type Account, co, Group, z } from "jazz-tools"
import { Issue } from "./issue"
import { PullRequest } from "./pull-request"

export type Repository = co.loaded<typeof Repository>

export const RepositoryStatus = z.enum(["not-connected", "connected", "lost-connection"])

export const Repository = co.map({
  /**
   * The sequential ID of the repository.
   */
  id: z.number(),

  /**
   * The status of the repository.
   */
  status: RepositoryStatus,

  /**
   * The owner of the repository.
   */
  owner: z.string(),

  /**
   * The name of the repository.
   */
  name: z.string(),

  /**
   * The ID of the installation used to access the repository.
   *
   * Will be null if repository is not connected yet.
   */
  installationId: z.number().optional(),

  /**
   * The list of all issues in the repository.
   */
  get issues() {
    return co.list(Issue)
  },

  /**
   * The list of all pull requests in the repository.
   */
  get pullRequests() {
    return co.list(PullRequest)
  },
})

/**
 * Gets the repository by its unique identifier.
 *
 * @param data The GitHub contract data.
 * @param repositoryId The unique identifier of the repository.
 * @returns The repository if found, otherwise null.
 */
export async function getRepositoryById(
  data: GitHubData,
  repositoryId: number,
): Promise<Repository | null> {
  return await loadBoxed(
    Repository,
    `repository.by-id.${repositoryId}`,
    data.$jazz.owner.$jazz.id,
    data.$jazz.loadedAs,
  )
}

/**
 * Gets or creates the repository by its owner and name.
 *
 * @param data The GitHub contract data.
 * @param owner The owner of the repository.
 * @param name The name of the repository.
 * @returns The repository.
 */
export async function getOrCreateRepository(
  data: GitHubData,
  owner: string,
  name: string,
): Promise<Repository> {
  owner = owner.toLowerCase()
  name = name.toLowerCase()

  const repository = await getRepositoryByOwnerAndName(data, owner, name)
  if (repository) {
    return repository
  }

  const loadedData = await data.$jazz.ensureLoaded({ resolve: { repositories: true } })

  const newRepository = Repository.create(
    {
      id: loadedData.repositories.length + 1,
      status: "not-connected",
      owner,
      name,
      issues: Repository.shape.issues.create(
        //
        [],
        Group.create(data.$jazz.loadedAs as Account),
      ),
      pullRequests: Repository.shape.pullRequests.create(
        [],
        Group.create(data.$jazz.loadedAs as Account),
      ),
    },
    Group.create(data.$jazz.loadedAs as Account),
  )

  // add to repositories list
  loadedData.repositories.$jazz.push(newRepository)

  // allow users with "repository:read:all" permission to read the new repository
  newRepository.$jazz.owner.addMember(loadedData.repositories.$jazz.owner, "reader")

  // allow users with access to issues or pull requests to read the new repository
  newRepository.issues.$jazz.owner.addMember(newRepository.$jazz.owner, "reader")
  newRepository.pullRequests.$jazz.owner.addMember(newRepository.$jazz.owner, "reader")

  // create indexes
  box(Repository).create(
    { value: newRepository },
    { unique: `repository.by-id.${newRepository.id}`, owner: data.$jazz.owner },
  )

  box(Repository).create(
    { value: newRepository },
    { unique: `repository.by-owner-and-name.${owner}.${name}`, owner: data.$jazz.owner },
  )

  return newRepository
}

/**
 * Gets the repository by its owner and name.
 *
 * @param data The GitHub contract data.
 * @param owner The owner of the repository.
 * @param name The name of the repository.
 * @returns The repository if found, otherwise null.
 */
export async function getRepositoryByOwnerAndName(
  data: GitHubData,
  owner: string,
  name: string,
): Promise<Repository | null> {
  return await loadBoxed(
    Repository,
    `repository.by-owner-and-name.${owner.toLowerCase()}.${name.toLowerCase()}`,
    data.$jazz.owner.$jazz.id,
    data.$jazz.loadedAs,
  )
}
