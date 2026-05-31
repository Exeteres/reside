import type { Logger } from "pino"
import { resolve } from "node:path"
import { readPackageJSON } from "pkg-types"
import { z } from "zod"

export const ResidePackageMetadata = z.object({
  image: z.string().min(1).optional(),
})

export type ResidePackageMetadata = z.infer<typeof ResidePackageMetadata>

export const ResideConfig = z.object({
  packageName: z.string(),
  packagePath: z.string(),
  reside: ResidePackageMetadata,
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

  const parsedReside = ResidePackageMetadata.safeParse(packageJson.reside ?? {})
  if (!parsedReside.success) {
    throw new Error(`Invalid package.json reside config: ${parsedReside.error.message}`)
  }

  return {
    packageName: packageJson.name,
    packagePath,
    reside: parsedReside.data,
  }
}
