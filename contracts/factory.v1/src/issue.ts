import { co, z } from "jazz-tools"

export const IssueStatus = z.enum([
  /**
   * The issue is open and awaiting action from the Copilot or user.
   */
  "open",

  /**
   * The issue is currently being worked on.
   */
  "in-progress",

  /**
   * The issue has been closed.
   */
  "closed",
])

export const Issue = co.map({
  /**
   * The sequential unique ID of the issue.
   *
   * For simplicity, it matches the ID of the real issue on GitHub.
   */
  id: z.number(),

  /**
   * The current status of the issue.
   */
  status: IssueStatus,

  /**
   * The title of the issue.
   *
   * Will be synced with the GitHub issue title.
   */
  title: z.string().min(1),

  /**
   * The body/description of the issue.
   *
   * Will be synced with the GitHub issue body.
   */
  body: z.string().min(1),
})
