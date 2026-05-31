import { CommitValidationError } from "../../definitions"

export { CommitValidationError }

type CommitLogEntry = {
  hash: string
  subject: string
  body: string
}

const conventionalCommitPattern =
  /^(feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert)(?:\([a-z0-9._/-]+\))?(?:!)?:\s+\S.*$/u

export function isConventionalCommitTitle(value: string): boolean {
  const normalized = value.normalize("NFKC")
  return conventionalCommitPattern.test(normalized)
}

export function validateBranchCommitLogOutput(output: string): void {
  const commits = parseCommitLogOutput(output)

  if (commits.length === 0) {
    throw new CommitValidationError("No commits found on branch for pull request")
  }

  for (const commit of commits) {
    const commitHash = commit.hash.slice(0, 8)
    const subject = commit.subject.trim()

    if (subject.length === 0) {
      throw new CommitValidationError(`Commit ${commitHash} has empty subject`)
    }

    if (subject !== commit.subject) {
      throw new CommitValidationError(
        `Commit ${commitHash} subject must be a single clean line without surrounding whitespace (subject="${truncateOneLine(commit.subject, 120)}")`,
      )
    }

    if (subject !== subject.toLowerCase()) {
      throw new CommitValidationError(
        `Commit ${commitHash} subject must be lowercase (subject="${truncateOneLine(subject, 120)}")`,
      )
    }

    if (!isConventionalCommitTitle(subject)) {
      throw new CommitValidationError(
        `Commit ${commitHash} subject must follow conventional commits format (subject="${truncateOneLine(subject, 120)}")`,
      )
    }

    if (commit.body.trim().length > 0) {
      throw new CommitValidationError(
        `Commit ${commitHash} must not contain commit body; move details to pull request body`,
      )
    }
  }
}

export function parseCommitLogOutput(output: string): CommitLogEntry[] {
  const parts = output.split("\u0000")
  const commits: CommitLogEntry[] = []

  for (let index = 0; index + 2 < parts.length; index += 3) {
    const hash = parts[index]?.trim() ?? ""
    const subject = parts[index + 1] ?? ""
    const body = parts[index + 2] ?? ""

    if (hash.length === 0) {
      continue
    }

    commits.push({ hash, subject, body })
  }

  return commits
}

function truncateOneLine(value: string, maxLength: number): string {
  const singleLine = value.replace(/\s+/g, " ").trim()
  if (singleLine.length <= maxLength) {
    return singleLine
  }

  return `${singleLine.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}
