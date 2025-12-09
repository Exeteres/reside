import { co, z } from "jazz-tools"
import { Repository } from "./repository"

export type Issue = co.loaded<typeof Issue>
export type IssueInfo = co.loaded<typeof IssueInfo>

export const IssueInfo = co.map({
  /**
   * The title of the issue.
   *
   * Automatically syncs with GitHub issue title.
   */
  title: z.string(),

  /**
   * The body/description of the issue.
   *
   * Automatically syncs with GitHub issue body.
   */
  body: z.string().optional(),
})

export const Issue = co.map({
  /**
   * The ID of the issue within the repository.
   *
   * Will be the same as the GitHub issue number.
   */
  id: z.number(),

  /**
   * The repository this issue belongs to.
   */
  get repository() {
    return Repository
  },

  /**
   * The info of the issue.
   *
   * Can be updated to change title/body of the issue on GitHub.
   */
  info: IssueInfo,
})
