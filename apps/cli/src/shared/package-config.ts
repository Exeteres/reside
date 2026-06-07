import type { Logger } from "pino"
import { resolve } from "node:path"
import { readPackageJSON } from "pkg-types"
import { z } from "zod"

export const ResideConfig = z.object({
  packageName: z.string(),
  packagePath: z.string(),
})

export type ResideConfig = z.infer<typeof ResideConfig>

export async function loadPackageConfig(
  logger: Logger,
  packagePath = process.cwd(),
): Promise<ResideConfig> {
  const packageJson = await readPackageJSON(resolve(packagePath, "package.json"))

  if (!packageJson.name) {
    throw new Error('Package.json does not have a "name" field')
  }

  logger.debug("loaded package config: %O", packageJson)

  return {
    packageName: packageJson.name,
    packagePath,
  }
}
