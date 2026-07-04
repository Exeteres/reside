import { existsSync } from "node:fs"
import path from "node:path"

const prismaSkillName = "reside-prisma"
const migrationPathPattern = /(^|\/)prisma\/migrations\/[^/]+\/.+/

export function getBlockedMigrationCreations(
  tool: string,
  args: unknown,
  worktree: string,
): string[] {
  if (tool === "apply_patch") {
    return getPatchMigrationCreations(args, worktree)
  }

  if (!isWriteLikeTool(tool) || !isRecord(args)) {
    return []
  }

  const targetPath = getDirectTargetPath(args)

  if (!targetPath || !isMigrationFile(targetPath, worktree)) {
    return []
  }

  return existsSync(toAbsolutePath(targetPath, worktree))
    ? []
    : [normalizePath(targetPath, worktree)]
}

export function createMigrationCreationError(paths: string[]): Error {
  return new Error(
    [
      "Skill enforcement blocked this Prisma migration creation.",
      `Load the "${prismaSkillName}" skill and follow its migration creation workflow instead of creating migration files directly.`,
      "Only editing existing migration files is allowed.",
      `Blocked paths: ${paths.join(", ")}.`,
    ].join("\n"),
  )
}

function getPatchMigrationCreations(args: unknown, worktree: string): string[] {
  if (!isRecord(args)) {
    return []
  }

  const patch = args.patchText ?? args.patch

  if (typeof patch !== "string") {
    return []
  }

  const blockedPaths = new Set<string>()
  const pattern = /^\*\*\* Add File: (.+)$/gm

  for (const match of patch.matchAll(pattern)) {
    const targetPath = match[1]

    if (targetPath && isMigrationFile(targetPath, worktree)) {
      blockedPaths.add(normalizePath(targetPath, worktree))
    }
  }

  return [...blockedPaths]
}

function isWriteLikeTool(tool: string): boolean {
  return tool === "write" || tool === "edit" || tool === "multiedit"
}

function getDirectTargetPath(args: Record<string, unknown>): string | undefined {
  const targetPath = args.filePath ?? args.path

  return typeof targetPath === "string" ? targetPath : undefined
}

function isMigrationFile(targetPath: string, worktree: string): boolean {
  return migrationPathPattern.test(normalizePath(targetPath, worktree))
}

function normalizePath(targetPath: string, worktree: string): string {
  const relativePath = path.isAbsolute(targetPath)
    ? path.relative(worktree, targetPath)
    : targetPath

  return relativePath.replace(/^\.\//, "")
}

function toAbsolutePath(targetPath: string, worktree: string): string {
  return path.isAbsolute(targetPath) ? targetPath : path.join(worktree, targetPath)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
