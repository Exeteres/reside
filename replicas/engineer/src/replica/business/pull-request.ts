import { isConventionalCommitTitle } from "./commit-validation"

export function hasIssueClosingTagAtBodyEnd(body: string, issueNumber?: number): boolean {
  const lastLine = body
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .at(-1)

  if (!lastLine) {
    return false
  }

  const match = /^closes\s+#(\d+)$/i.exec(lastLine)
  if (!match) {
    return false
  }

  if (!issueNumber) {
    return true
  }

  return Number.parseInt(match[1] ?? "", 10) === issueNumber
}

export function validatePullRequestTitle(title: string): void {
  const normalized = title.trim()
  if (normalized.length === 0) {
    throw new Error("Pull request title must not be empty")
  }

  if (!/^[A-ZА-ЯЁ]/.test(normalized)) {
    throw new Error("Pull request title must start with a capital letter")
  }

  if (isConventionalCommitTitle(normalized)) {
    throw new Error(
      "Pull request title must be a regular title and must not use conventional-commit format",
    )
  }
}
