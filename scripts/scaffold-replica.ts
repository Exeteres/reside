#!/usr/bin/env bun

import { constants } from "node:fs"
import {
  access,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import path from "node:path"

type PackageJson = {
  name?: unknown
  [key: string]: unknown
}

type ResideManifest = {
  version?: unknown
  image?: unknown
  [key: string]: unknown
}

const usage = "Usage: bun scripts/scaffold-replica.ts <source-replica> <new-replica> [russian-title]"

const skippedDirectoryNames = new Set(["node_modules", ".devenv", ".engineer-session"])
const textExtensions = new Set([
  ".json",
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".md",
  ".prisma",
  ".sql",
  ".toml",
  ".yaml",
  ".yml",
])

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

function assertReplicaName(value: string, label: string): void {
  if (!/^[a-z][a-z0-9-]*$/.test(value)) {
    fail(`Error: ${label} must be kebab-case and start with a lowercase letter`)
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function toPascalCase(value: string): string {
  return value
    .split("-")
    .filter(part => part.length > 0)
    .map(part => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("")
}

function toCapitalized(value: string): string {
  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")

  return `${year}-${month}-${day}`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function replaceReplicaToken(content: string, sourceName: string, targetName: string): string {
  return content.replace(
    new RegExp(`(?<![a-z0-9-])${escapeRegExp(sourceName)}(?![a-z0-9-])`, "g"),
    targetName,
  )
}

function replaceReplicaPathToken(value: string, sourceName: string, targetName: string): string {
  return value.replace(
    new RegExp(`(?<![a-z0-9])${escapeRegExp(sourceName)}(?![a-z0-9])`, "g"),
    targetName,
  )
}

function shouldSkip(relativePath: string, statsDirectory: boolean): boolean {
  const parts = relativePath.split(path.sep)
  if (statsDirectory && parts.some(part => skippedDirectoryNames.has(part))) {
    return true
  }

  if (parts.includes("_generated")) {
    return true
  }

  if (parts.includes("migrations")) {
    return true
  }

  return false
}

async function copyTemplate(sourceDir: string, targetDir: string, relativePath = ""): Promise<void> {
  const currentSource = path.join(sourceDir, relativePath)
  const currentTarget = path.join(targetDir, relativePath)
  const stats = await lstat(currentSource)

  if (shouldSkip(relativePath, stats.isDirectory())) {
    return
  }

  if (stats.isSymbolicLink()) {
    const target = await readFileLink(currentSource)
    await mkdir(path.dirname(currentTarget), { recursive: true })
    await symlink(target, currentTarget)
    return
  }

  if (stats.isDirectory()) {
    await mkdir(currentTarget, { recursive: true })
    const entries = await readdir(currentSource)
    for (const entry of entries) {
      await copyTemplate(sourceDir, targetDir, path.join(relativePath, entry))
    }
    return
  }

  if (!stats.isFile()) {
    return
  }

  await mkdir(path.dirname(currentTarget), { recursive: true })
  await copyFile(currentSource, currentTarget)
}

async function readFileLink(filePath: string): Promise<string> {
  return await readlink(filePath)
}

async function rewriteTextFiles(input: {
  targetDir: string
  sourceName: string
  targetName: string
}): Promise<void> {
  const sourcePascal = toPascalCase(input.sourceName)
  const targetPascal = toPascalCase(input.targetName)
  const sourceCapitalized = toCapitalized(input.sourceName)
  const targetCapitalized = toCapitalized(input.targetName)

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(entryPath)
        continue
      }

      if (!entry.isFile() || !textExtensions.has(path.extname(entry.name))) {
        continue
      }

      const current = await readFile(entryPath, "utf8")
      const next = replaceReplicaToken(
        current
          .replaceAll(`@replicas/${input.sourceName}`, `@replicas/${input.targetName}`)
          .replaceAll(sourcePascal, targetPascal)
          .replaceAll(sourceCapitalized, targetCapitalized),
        input.sourceName,
        input.targetName,
      )

      if (next !== current) {
        await writeFile(entryPath, next, "utf8")
      }
    }
  }

  await visit(input.targetDir)
}

async function renameTemplatePaths(input: {
  targetDir: string
  sourceName: string
  targetName: string
}): Promise<void> {
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true })

    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(entryPath)
      }

      const nextName = replaceReplicaPathToken(entry.name, input.sourceName, input.targetName)
      if (nextName === entry.name) {
        continue
      }

      const nextPath = path.join(directory, nextName)
      if (await exists(nextPath)) {
        fail(`Error: cannot rename scaffold path because target already exists: ${nextPath}`)
      }

      await rename(entryPath, nextPath)
    }
  }

  await visit(input.targetDir)
}

async function updatePackageJson(targetDir: string, targetName: string): Promise<void> {
  const packagePath = path.join(targetDir, "package.json")
  if (!(await exists(packagePath))) {
    return
  }

  const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as PackageJson
  packageJson.name = `@replicas/${targetName}`
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8")
}

async function updateManifest(targetDir: string, targetName: string): Promise<void> {
  const manifestPath = path.join(targetDir, "reside.manifest.json")
  const manifest: ResideManifest = (await exists(manifestPath))
    ? (JSON.parse(await readFile(manifestPath, "utf8")) as ResideManifest)
    : {}

  manifest.version = "0.1.0"
  manifest.image = `ghcr.io/exeteres/reside/replicas/${targetName}`
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
}

async function updateChangelog(
  targetDir: string,
  targetName: string,
  title?: string,
): Promise<void> {
  const changelogPath = path.join(targetDir, "CHANGELOG.md")
  const today = formatLocalDate(new Date())
  const replicaTitle = title?.trim() || toCapitalized(targetName)
  const content = `# Changelog\n\n## 0.1.0 - ${today}\n\nСоздана начальная версия ${replicaTitle}.\n`

  await writeFile(changelogPath, content, "utf8")
}

async function ensurePrismaDirectories(targetDir: string): Promise<void> {
  const prismaDir = path.join(targetDir, "prisma")
  if (!(await exists(prismaDir))) {
    return
  }

  await mkdir(path.join(prismaDir, "migrations"), { recursive: true })
  await writeFile(
    path.join(prismaDir, "migrations", "migration_lock.toml"),
    '# Please do not edit this file manually\n# It should be added in your version-control system (e.g., Git)\nprovider = "postgresql"\n',
    "utf8",
  )
}

async function main(): Promise<void> {
  const sourceName = process.argv[2]?.trim() ?? ""
  const targetName = process.argv[3]?.trim() ?? ""
  const title = process.argv[4]?.trim()

  if (!sourceName || !targetName) {
    fail(usage)
  }

  assertReplicaName(sourceName, "source replica")
  assertReplicaName(targetName, "new replica")

  if (sourceName === targetName) {
    fail("Error: source and new replica names must be different")
  }

  const rootDir = process.cwd()
  const sourceDir = path.join(rootDir, "replicas", sourceName)
  const targetDir = path.join(rootDir, "replicas", targetName)

  if (!(await exists(sourceDir))) {
    fail(`Error: source replica does not exist: ${sourceName}`)
  }

  if (await exists(targetDir)) {
    fail(`Error: target replica already exists: ${targetName}`)
  }

  await copyTemplate(sourceDir, targetDir)
  await renameTemplatePaths({ targetDir, sourceName, targetName })
  await rewriteTextFiles({ targetDir, sourceName, targetName })
  await updatePackageJson(targetDir, targetName)
  await updateManifest(targetDir, targetName)
  await updateChangelog(targetDir, targetName, title)
  await ensurePrismaDirectories(targetDir)
  await rm(path.join(targetDir, "src", "database", "_generated"), { recursive: true, force: true })

  console.log(`Created replicas/${targetName} from replicas/${sourceName}`)
  console.log(
    "Next steps: adjust domain logic, register topology, run generators, then follow docs/changes.md for version and changelog updates.",
  )
}

await main()
