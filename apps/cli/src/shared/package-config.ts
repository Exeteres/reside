import { ResideManifest } from "@reside/shared"
import { resolve } from "node:path"
import type { Logger } from "pino"
import { readPackageJSON } from "pkg-types"
import { z } from "zod"

export const ResideConfig = z.object({
  packageName: z.string(),
  manifest: ResideManifest,
})

export type ResideConfig = z.infer<typeof ResideConfig>

export async function loadPackageConfig(logger: Logger): Promise<ResideConfig> {
  const packageJson = await readPackageJSON()

  if (!packageJson.name) {
    throw new Error("Package.json does not have a name field.")
  }

  const manifestPath = resolve(process.cwd(), "reside.manifest.ts")
  const { default: manifest } = await import(manifestPath)
  logger.debug("loaded manifest: %O", manifest)

  const parsedManifest = ResideManifest.safeParse(manifest)
  if (!parsedManifest.success) {
    throw new Error(`Invalid reside manifest: ${parsedManifest.error.message}`)
  }

  return {
    packageName: packageJson.name,
    manifest: parsedManifest.data,
  }
}
