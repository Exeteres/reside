import { co, z } from "jazz-tools"
import { Repository } from "./repository"

export type PullRequest = co.loaded<typeof PullRequest>
export type PullRequestInfo = co.loaded<typeof PullRequestInfo>

export const PullRequestInfo = co.map({
  /**
   * The title of the pull request.
   *
   * Automatically syncs with GitHub pull request title.
   */
  title: z.string(),

  /**
   * The body/description of the pull request.
   *
   * Automatically syncs with GitHub pull request body.
   */
  body: z.string().optional(),
})

export const PullRequest = co.map({
  /**
   * The ID of the pull request within the repository.
   *
   * Will be the same as the GitHub pull request number.
   */
  id: z.number(),

  /**
   * The repository this pull request belongs to.
   */
  get repository() {
    return Repository
  },

  /**
   * The info of the pull request.
   *
   * Can be updated to change title/body of the pull request on GitHub.
   */
  info: PullRequestInfo,
})
