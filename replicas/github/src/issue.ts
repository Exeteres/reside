import {
  type GitHubData,
  getIssueById,
  Issue,
  IssueInfo,
  type Repository,
} from "@contracts/github.v1"
import { box } from "@reside/shared"

/**
 * Synchronizes an issue entity with the given data.
 *
 * If the issue with the specified ID already exists in the repository, its title and body are updated.
 * If it does not exist, a new issue entity is created and added to the repository.
 *
 * @param data The GitHub contract data.
 * @param repository The repository to which the issue belongs.
 * @param id The unique identifier of the issue.
 * @param title The title of the issue.
 * @param body The body content of the issue (optional).
 * @returns The synchronized issue entity.
 */
export async function syncIssueEntity(
  data: GitHubData,
  repository: Repository,
  id: number,
  title: string,
  body?: string,
): Promise<Issue> {
  const existingIssue = await getIssueById(data, repository.id, id)

  if (existingIssue) {
    const loadedIssue = await existingIssue.$jazz.ensureLoaded({ resolve: { info: true } })

    loadedIssue.info.$jazz.set("title", title)
    loadedIssue.info.$jazz.set("body", body)

    return existingIssue
  }

  const loadedRepository = await repository.$jazz.ensureLoaded({ resolve: { issues: true } })

  const newIssue = Issue.create(
    {
      id,
      // create separate group for issue info to allow write permission on it
      info: IssueInfo.create({
        title,
        body,
      }),
      repository: loadedRepository,
    },
    { owner: data.$jazz.owner },
  )

  // add the issue to the repository's issues list
  loadedRepository.issues.$jazz.push(newIssue)

  // allow users with "issue:read:repository" permission to read the new issue
  newIssue.$jazz.owner.addMember(loadedRepository.issues.$jazz.owner, "reader")

  // allow users with read access to the issue also read its info
  newIssue.info.$jazz.owner.addMember(newIssue.$jazz.owner, "reader")

  // create index for issue by id within the repository
  box(Issue).create(
    { value: newIssue },
    {
      unique: `object.by-id.${repository.id}.${id}`,
      owner: data.$jazz.owner,
    },
  )

  return newIssue
}
