import { isRecord } from "@reside/utils"

type HelmCommandResult = {
  exitCode: number
  stdout: string
  stderr: string
}

type HelmHistoryEntry = {
  revision: number
  status: string
}

type PendingReleaseRecoveryStrategy = "rollback" | "uninstall"

/**
 * Resolves interrupted Helm operations before starting a new upgrade.
 *
 * If the latest release revision is left in a pending state,
 * this restores the last stable revision or removes the partial install.
 *
 * @param namespace The namespace of the Helm release.
 * @param releaseName The Helm release name.
 * @returns Nothing.
 */
export async function recoverPendingHelmRelease(
  namespace: string,
  releaseName: string,
  strategy: PendingReleaseRecoveryStrategy = "rollback",
): Promise<void> {
  const historyResult = await runHelmCommand([
    "helm",
    "history",
    releaseName,
    "--namespace",
    namespace,
    "-o",
    "json",
  ])

  if (historyResult.exitCode !== 0) {
    return
  }

  const history = parseHelmHistory(historyResult.stdout)
  const latestEntry = history.at(-1)
  if (!latestEntry || !latestEntry.status.startsWith("pending-")) {
    return
  }

  if (strategy === "uninstall") {
    await uninstallRelease(namespace, releaseName)
    return
  }

  const rollbackTarget = findRollbackTarget(history, latestEntry.revision)
  if (rollbackTarget) {
    const rollbackResult = await runHelmCommand([
      "helm",
      "rollback",
      releaseName,
      rollbackTarget.revision.toString(),
      "--namespace",
      namespace,
      "--wait",
      "--timeout",
      "10m",
    ])

    if (rollbackResult.exitCode !== 0) {
      throw new Error(`Helm rollback failed with exit code ${rollbackResult.exitCode}`)
    }

    return
  }

  await uninstallRelease(namespace, releaseName)
}

async function uninstallRelease(namespace: string, releaseName: string): Promise<void> {
  const uninstallResult = await runHelmCommand([
    "helm",
    "uninstall",
    releaseName,
    "--namespace",
    namespace,
    "--wait",
    "--ignore-not-found",
  ])

  if (uninstallResult.exitCode !== 0) {
    throw new Error(`Helm uninstall failed with exit code ${uninstallResult.exitCode}`)
  }
}

/**
 * Runs a Helm CLI command and mirrors its output to the current process.
 *
 * @param command The Helm command and arguments.
 * @returns The process exit code and captured output.
 */
export async function runHelmCommand(command: string[]): Promise<HelmCommandResult> {
  const processHandle = Bun.spawn(command, {
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  })

  const [stdout, stderr, exitCode] = await Promise.all([
    readProcessStream(processHandle.stdout),
    readProcessStream(processHandle.stderr),
    processHandle.exited,
  ])

  if (stdout.length > 0) {
    process.stdout.write(stdout)
  }

  if (stderr.length > 0) {
    process.stderr.write(stderr)
  }

  return {
    exitCode,
    stdout,
    stderr,
  }
}

function findRollbackTarget(
  history: HelmHistoryEntry[],
  latestRevision: number,
): HelmHistoryEntry | undefined {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index]
    if (!entry) {
      continue
    }

    if (entry.revision >= latestRevision) {
      continue
    }

    if (entry.status === "deployed" || entry.status === "superseded") {
      return entry
    }
  }

  return undefined
}

function parseHelmHistory(output: string): HelmHistoryEntry[] {
  let parsed: unknown

  try {
    parsed = JSON.parse(output)
  } catch {
    return []
  }

  if (!Array.isArray(parsed)) {
    return []
  }

  const history: HelmHistoryEntry[] = []

  for (const entry of parsed) {
    if (!isRecord(entry)) {
      continue
    }

    const revision = entry.revision
    const status = entry.status
    if (typeof revision !== "number" || typeof status !== "string") {
      continue
    }

    history.push({
      revision,
      status,
    })
  }

  return history
}

async function readProcessStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) {
    return ""
  }

  return await new Response(stream).text()
}
