import { dirname } from "node:path"
import { readPackageJSON, resolvePackageJSON } from "pkg-types"
import { unique } from "remeda"

export type IncludedPackage = {
  name: string
  path: string
}

/**
 * Gets all packages to include to the container for the given package, including transitive dependencies.
 *
 * The last package in the returned array is requested package itself.
 *
 * @param packageName The name of the package to get dependencies for.
 * @param dependencyMap The map to cache dependencies.
 * @returns The list of all packages to include.
 */
export async function getAllPackagesToInclude(
  packageName: string,
  dependencyMap: Map<string, IncludedPackage[]> = new Map(),
  fromPackagePath = process.cwd(),
): Promise<IncludedPackage[]> {
  const existingDependencies = dependencyMap.get(packageName)
  if (existingDependencies) {
    return existingDependencies
  }

  const packagePath = await Bun.resolve(`${packageName}/package.json`, fromPackagePath)
  const packageJson = await readPackageJSON(packagePath)

  if (!packageJson.name) {
    throw new Error(`Package at path "${packagePath}" does not have a name.`)
  }

  let allPackages: IncludedPackage[] = []

  for (const [dependency, version] of Object.entries(packageJson.dependencies ?? {})) {
    if (!version.startsWith("workspace:")) {
      continue
    }

    const subDependencies = await getAllPackagesToInclude(
      dependency,
      dependencyMap,
      dirname(packagePath),
    )

    allPackages = unique([...allPackages, ...subDependencies])
  }

  allPackages = [...allPackages, { name: packageJson.name, path: dirname(packagePath) }]

  dependencyMap.set(packageName, allPackages)
  return allPackages
}

/**
 * Gets the root path of the monorepo by looking for the nearest package.json with "workspaces" field.
 *
 * @returns The root path of the monorepo.
 */
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
