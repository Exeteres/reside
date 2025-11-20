import type { Replica, ReplicaVersion } from "@contracts/alpha.v1"
import { resolveDisplayInfo } from "./ui"
import styles from "ansi-styles"

const versionStatusStyles: Partial<
  Record<ReplicaVersion["status"], { open: string; close: string }>
> = {
  running: styles.green,
  "running-outdated": styles.yellow,
  starting: styles.yellow,
  stopping: styles.magenta,
  degraded: styles.yellow,
  completed: styles.cyan,
  stopped: styles.cyan,
  error: styles.red,
  unknown: styles.gray,
}

const bold = styles.bold

const stylize = (text: string, ...styleSet: Array<{ open: string; close: string }>) =>
  styleSet.reduce((acc, style) => `${style.open}${acc}${style.close}`, text)

function formatBoolean(value: boolean): string {
  return value ? stylize("Yes", styles.green) : stylize("No", styles.gray)
}

function formatStatus(status: ReplicaVersion["status"]): string {
  const statusStyle = versionStatusStyles[status] ?? styles.white
  return stylize(status, statusStyle, bold)
}

function formatVersion(label: string, version: ReplicaVersion): string[] {
  const lines: string[] = []
  const header = `${stylize(`${label}:`, bold, styles.magenta)} ${stylize(`#${version.id}`, styles.whiteBright)}`
  lines.push(header)
  lines.push(`    ${stylize("Status:", bold)} ${formatStatus(version.status)}`)

  if (version.image) {
    lines.push(`    ${stylize("Image:", bold)} ${stylize(version.image, styles.white)}`)
  }

  if (version.digest) {
    lines.push(`    ${stylize("Digest:", bold)} ${stylize(version.digest, styles.gray)}`)
  }

  return lines
}

export async function renderReplica(replica: Replica): Promise<string> {
  const loadedReplica = (await replica.$jazz.ensureLoaded({
    resolve: {
      currentVersion: true,
      versions: { $each: true },
    },
  })) as Replica

  const lines: string[] = []

  lines.push(
    `${stylize("Replica:", bold, styles.cyan)} ${stylize(loadedReplica.name, styles.whiteBright)} ${stylize(`(ID: ${loadedReplica.id})`, styles.gray)}`,
  )
  lines.push(
    `${stylize("Identity:", bold, styles.cyan)} ${stylize(loadedReplica.identity, styles.white)}`,
  )
  lines.push(
    `${stylize("Class:", bold, styles.cyan)} ${stylize(loadedReplica.info.class, styles.white)} | ${stylize("Exclusive:", bold)} ${formatBoolean(loadedReplica.info.exclusive)} | ${stylize("Scalable:", bold)} ${formatBoolean(loadedReplica.info.scalable)}`,
  )

  const currentVersion = loadedReplica.currentVersion as ReplicaVersion | null
  if (!currentVersion) {
    lines.push(stylize("No versions available", styles.red))
    return lines.join("\n")
  }

  const currentDisplayInfo = resolveDisplayInfo(currentVersion.displayInfo)
  if (currentDisplayInfo?.title) {
    lines.push(
      `${stylize("Title:", bold, styles.cyan)} ${stylize(currentDisplayInfo.title, styles.whiteBright)}`,
    )
  }

  if (currentDisplayInfo?.description) {
    lines.push(stylize(currentDisplayInfo.description, styles.dim))
  }

  const sortedVersions = Array.from(
    loadedReplica.versions as unknown as Iterable<ReplicaVersion>,
  ).sort((a, b) => a.id - b.id)
  const previousVersion = sortedVersions.filter(version => version.id !== currentVersion.id).pop()

  const resolvedCurrentVersion = currentVersion as ReplicaVersion

  lines.push("")
  lines.push(...formatVersion("Current Version", resolvedCurrentVersion))

  if (previousVersion) {
    lines.push("")
    lines.push(...formatVersion("Previous Version", previousVersion))
  }

  return lines.join("\n")
}
