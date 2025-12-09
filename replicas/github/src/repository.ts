import { type GitHubData, Repository } from "@contracts/github.v1"
import { box, loadBoxed } from "@reside/shared"

/**
 * Gets the repository by its unique identifier.
 *
 * @param data The GitHub contract data.
 * @param repositoryId The unique identifier of the repository.
 * @returns The repository if found, otherwise null.
 */
export async function getRepositoryByInstallationId(
  data: GitHubData,
  installationId: number,
): Promise<Repository | null> {
  return await loadBoxed(
    Repository,
    `repository.by-installation-id.${installationId}`,
    data.$jazz.owner.$jazz.id,
    data.$jazz.loadedAs,
  )
}

/**
 * Connects the repository with the given installation ID.
 *
 * @param data The GitHub contract data.
 * @param repository The repository to connect.
 * @param installationId The installation ID to associate with the repository.
 */
export function connectRepository(
  data: GitHubData,
  repository: Repository,
  installationId: number,
): void {
  repository.$jazz.set("installationId", installationId)

  if (repository.status !== "connected") {
    repository.$jazz.set("status", "connected")
  }

  // create index for installationId
  box(Repository).create(
    { value: repository },
    {
      unique: `repository.by-installation-id.${installationId}`,
      owner: data.$jazz.owner,
    },
  )
}
