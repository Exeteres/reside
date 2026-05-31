export function extractWorkflowRunId(detailsUrl: string): number | undefined {
  const match = /\/actions\/runs\/(\d+)/.exec(detailsUrl)
  if (!match?.[1]) {
    return undefined
  }

  const runId = Number.parseInt(match[1], 10)
  if (!Number.isFinite(runId)) {
    return undefined
  }

  return runId
}

export function extractFailureMessageFromLog(logText: string): string {
  const lines = logText
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0)

  const failureLine = [...lines].reverse().find(line => {
    return /(error|failed|exception|panic|npm ERR!|ELIFECYCLE|TypeScript error|AssertionError)/i.test(
      line,
    )
  })

  if (failureLine) {
    return truncateOneLine(failureLine, 1200)
  }

  return truncateOneLine(lines.at(-1) ?? "ci:check failed without log details", 1200)
}

function truncateOneLine(value: string, maxLength: number): string {
  const singleLine = value.replace(/\s+/g, " ").trim()
  if (singleLine.length <= maxLength) {
    return singleLine
  }

  return `${singleLine.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}
