#!/usr/bin/env bun

import { readFile, writeFile } from "node:fs/promises"
import { access } from "node:fs/promises"
import { constants } from "node:fs"
import path from "node:path"

type IncrementType = "minor" | "patch"

type ResideManifest = {
  version?: unknown
  image?: unknown
}

const usage = "Usage: bun scripts/update-version.ts <replica-name> <minor|patch> <changelog-entry>"

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

function countSentences(value: string): number {
  const matches = value.match(/[.!?]+(?:\s+|$)/g)
  return matches?.length ?? 0
}

function bumpVersion(current: string, incType: IncrementType): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current)
  if (!match) {
    fail(`Error: invalid version in reside.manifest.json: "${current}"`)
  }

  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])

  // major bumps are forbidden by policy, so major is always preserved
  if (incType === "minor") {
    return `${major}.${minor + 1}.0`
  }

  return `${major}.${minor}.${patch + 1}`
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function main(): Promise<void> {
  if (process.argv.length !== 5) {
    fail(usage)
  }

  const replicaName = process.argv[2]?.trim() ?? ""
  const incTypeRaw = process.argv[3]?.trim() ?? ""
  const changelogEntry = process.argv[4]?.trim() ?? ""

  if (!replicaName) {
    fail("Error: replica name must not be empty")
  }

  if (incTypeRaw !== "minor" && incTypeRaw !== "patch") {
    fail("Error: increment type must be minor or patch")
  }

  if (!changelogEntry) {
    fail("Error: changelog entry must not be empty")
  }

  if (!/[А-Яа-яЁё]/.test(changelogEntry)) {
    fail("Error: changelog entry must be written in Russian")
  }

  const sentenceCount = countSentences(changelogEntry)
  if (sentenceCount < 1 || sentenceCount > 5) {
    fail("Error: changelog entry must be a short paragraph with 1-5 sentences")
  }

  const incType: IncrementType = incTypeRaw
  const rootDir = process.cwd()
  const replicaDir = path.join(rootDir, "replicas", replicaName)
  const manifestPath = path.join(replicaDir, "reside.manifest.json")
  const changelogPath = path.join(replicaDir, "CHANGELOG.md")

  if (!(await exists(replicaDir))) {
    fail(`Error: replica does not exist: ${replicaName}`)
  }

  if (!(await exists(manifestPath))) {
    fail(`Error: reside.manifest.json not found for replica: ${replicaName}`)
  }

  const manifestRaw = await readFile(manifestPath, "utf8")
  const manifest = JSON.parse(manifestRaw) as ResideManifest
  const currentVersion = typeof manifest.version === "string" ? manifest.version : ""

  const nextVersion = bumpVersion(currentVersion, incType)
  manifest.version = nextVersion

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")

  const today = new Date().toISOString().slice(0, 10)
  const newSection = `## ${nextVersion} - ${today}\n\n${changelogEntry}\n`

  const hasChangelog = await exists(changelogPath)
  const existingChangelog = hasChangelog ? await readFile(changelogPath, "utf8") : ""
  const header = "# Changelog\n\n"

  let oldBody = ""
  if (existingChangelog) {
    if (existingChangelog.startsWith("# Changelog")) {
      oldBody = existingChangelog.replace(/^# Changelog\s*/u, "").trim()
    } else {
      oldBody = existingChangelog.trim()
    }
  }

  const nextChangelog = oldBody
    ? `${header}${newSection}\n${oldBody}\n`
    : `${header}${newSection}`

  await writeFile(changelogPath, nextChangelog, "utf8")

  console.log(`Updated ${path.relative(rootDir, manifestPath)} to version ${nextVersion}`)
  console.log(`Updated ${path.relative(rootDir, changelogPath)}`)
  console.log("Note: follow docs/changes.md for replica versioning and changelog policy.")
}

await main()
