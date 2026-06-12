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
    .map(line => normalizeWorkflowLogLine(line))
    .filter(line => line.length > 0)

  const failureLines = [...lines].reverse().filter(isFailureLine)
  const failureLine = failureLines.find(line => {
    return isSpecificFailureLine(line) && !isGenericRunnerFailureLine(line)
  })

  if (failureLine) {
    return truncateOneLine(failureLine, 1200)
  }

  const fallbackFailureLine = failureLines.find(line => !isGenericRunnerFailureLine(line))

  if (fallbackFailureLine) {
    return truncateOneLine(fallbackFailureLine, 1200)
  }

  return truncateOneLine(lines.at(-1) ?? "ci:check failed without log details", 1200)
}

function normalizeWorkflowLogLine(line: string): string {
  return line
    .trim()
    .replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s+/u, "")
    .replace(/^##\[(?:error|warning|debug|group|endgroup)\]/iu, "")
    .trim()
}

function isFailureLine(line: string): boolean {
  return /(error|failed|exception|panic|npm ERR!|ELIFECYCLE|TypeScript error|AssertionError)/i.test(
    line,
  )
}

function isSpecificFailureLine(line: string): boolean {
  return /(?:\bTS\d{4}\b|error TS|src\/.+:\d+:\d+|Cannot find module|cannot find name|Property .+ does not exist|is not assignable|SyntaxError|ReferenceError|TypeError|AssertionError|Expected:|Received:|biome|lint|test failed)/i.test(
    line,
  )
}

function isGenericRunnerFailureLine(line: string): boolean {
  return /^(Process completed with exit code \d+\.?|The process .+ failed with exit code \d+\.?|Error: Process completed with exit code \d+\.?)$/i.test(
    line,
  )
}

function truncateOneLine(value: string, maxLength: number): string {
  const singleLine = value.replace(/\s+/g, " ").trim()
  if (singleLine.length <= maxLength) {
    return singleLine
  }

  return `${singleLine.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}
