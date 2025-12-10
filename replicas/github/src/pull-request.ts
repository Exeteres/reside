import {
  type GitHubData,
  getPullRequestById,
  PullRequest,
  PullRequestInfo,
  type PullRequestStatus,
  type Repository,
} from "@contracts/github.v1"
import { box } from "@reside/shared"

/**
 * Synchronizes a pull request entity with the given data.
 *
 * If the pull request with the specified ID already exists in the repository, its title and body are updated.
 * If it does not exist, a new pull request entity is created and added to the repository.
 *
 * @param data The GitHub contract data.
 * @param repository The repository to which the pull request belongs.
 * @param id The unique identifier of the pull request.
 * @param title The title of the pull request.
 * @param body The body content of the pull request (optional).
 * @returns The synchronized pull request entity.
 */
export async function syncPullRequestEntity(
  data: GitHubData,
  repository: Repository,
  id: number,
  status: PullRequestStatus,
  title: string,
  body?: string,
): Promise<PullRequest> {
  const existingPullRequest = await getPullRequestById(data, repository.id, id)

  if (existingPullRequest) {
    const loadedPullRequest = await existingPullRequest.$jazz.ensureLoaded({
      resolve: { info: true },
    })

    loadedPullRequest.info.$jazz.set("title", title)
    loadedPullRequest.info.$jazz.set("body", body)

    return existingPullRequest
  }

  const loadedRepository = await repository.$jazz.ensureLoaded({ resolve: { pullRequests: true } })

  const newPullRequest = PullRequest.create(
    {
      id,
      status,
      // create separate group for pull request info to allow write permission on it
      info: PullRequestInfo.create({
        title,
        body,
      }),
      repository: loadedRepository,
    },
    { owner: data.$jazz.owner },
  )

  // add the pull request to the repository's pull requests list
  loadedRepository.pullRequests.$jazz.push(newPullRequest)

  // allow users with "pull-request:read:repository" permission to read the new pull request
  newPullRequest.$jazz.owner.addMember(loadedRepository.pullRequests.$jazz.owner, "reader")

  // allow users with read access to the pull request also read its info
  newPullRequest.info.$jazz.owner.addMember(newPullRequest.$jazz.owner, "reader")

  // create index for pull request by id within the repository
  box(PullRequest).create(
    { value: newPullRequest },
    {
      unique: `object.by-id.${repository.id}.${id}`,
      owner: data.$jazz.owner,
    },
  )

  return newPullRequest
}
