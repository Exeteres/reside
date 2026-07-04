import { constants } from "node:fs"
import { access } from "node:fs/promises"
import path from "node:path"
import { fail } from "@reside/skill-reside-core/process"

export async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

export async function assertRepositoryRoot(): Promise<void> {
  if (!(await exists(path.join(process.cwd(), "README.md")))) {
    fail("Error: run this script from the repository root")
  }

  if (!(await exists(path.join(process.cwd(), "AGENTS.md")))) {
    fail("Error: run this script from the repository root")
  }
}

export async function findRepositoryRoot(startDir = process.cwd()): Promise<string> {
  let currentDir = startDir

  while (true) {
    if (
      (await exists(path.join(currentDir, "README.md"))) &&
      (await exists(path.join(currentDir, "AGENTS.md"))) &&
      (await exists(path.join(currentDir, "package.json")))
    ) {
      return currentDir
    }

    const parentDir = path.dirname(currentDir)
    if (parentDir === currentDir) {
      fail("Error: repository root not found")
    }

    currentDir = parentDir
  }
}
