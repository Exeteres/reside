import { access, readdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { readPackageJSON, resolvePackageJSON } from "pkg-types"

export type WorkspacePackagePath = {
  path: string
}

export async function getRootPath(): Promise<string> {
  let current = process.cwd()

  while (current !== "/") {
    const packageJsonPath = await resolvePackageJSON(current)
    const packageJson = await readPackageJSON(packageJsonPath)

    if (packageJson.workspaces) {
      return dirname(packageJsonPath)
    }

    current = dirname(current)
  }

  throw new Error(`Could not find monorepo root starting from "${process.cwd()}"`)
}

export async function getWorkspacePackagePaths(rootPath: string): Promise<WorkspacePackagePath[]> {
  const packageJson = await readPackageJSON(resolve(rootPath, "package.json"))
  const workspaces = packageJson.workspaces

  if (!Array.isArray(workspaces)) {
    throw new Error("Root package.json workspaces must be an array")
  }

  const paths: WorkspacePackagePath[] = []

  for (const workspacePattern of workspaces) {
    if (!workspacePattern.endsWith("/*")) {
      throw new Error(`Unsupported workspace pattern "${workspacePattern}"`)
    }

    const workspaceDirectory = workspacePattern.slice(0, -2)
    const absoluteWorkspaceDirectory = resolve(rootPath, workspaceDirectory)
    const entries = await readdir(absoluteWorkspaceDirectory, {
      withFileTypes: true,
    })

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue
      }

      const packagePath = `${workspaceDirectory}/${entry.name}`
      const packageJsonPath = resolve(rootPath, packagePath, "package.json")

      try {
        await access(packageJsonPath)
      } catch {
        continue
      }

      paths.push({ path: packagePath })
    }
  }

  return paths.toSorted((left, right) => left.path.localeCompare(right.path))
}
