import type { ResideLogger } from "./logger"
import { stat } from "node:fs/promises"
import { relative, resolve } from "node:path"
import { createDockerfile } from "./docker"
import { loadPackageConfig } from "./package-config"
import { type CommandLog, runCommand } from "./process"
import { getRootPath, getWorkspacePackagePaths } from "./project"

export type BuildImageArgs = {
  commandLog?: CommandLog
  logger: ResideLogger
  tag: string
  push: boolean
  interactiveDockerOutput?: boolean
}

export async function buildCurrentPackageImage(args: BuildImageArgs): Promise<string> {
  return await buildPackageImage(process.cwd(), args)
}

export async function buildPackageImage(
  packagePath: string,
  args: BuildImageArgs,
): Promise<string> {
  const config = await loadPackageConfig(args.logger, packagePath)

  args.logger.info('building image for package "%s"', config.packageName)

  const rootPath = await getRootPath()
  args.logger.info("monorepo root path: %s", rootPath)

  const workspacePackages = await getWorkspacePackagePaths(rootPath)
  const baseDockerfilePath = resolve(rootPath, "apps/cli/assets/runtime.dockerfile")
  const baseDockerfile = await Bun.file(baseDockerfilePath).text()
  const replicaPath = relative(rootPath, packagePath).replaceAll("\\", "/")
  const hasPrismaDirectory = await pathExists(resolve(packagePath, "prisma"))
  const hasPrismaConfig = await pathExists(resolve(packagePath, "prisma.config.ts"))
  const hasChangelog = await pathExists(resolve(packagePath, "CHANGELOG.md"))
  const hasWorkflows = await pathExists(resolve(packagePath, "src/workflows/index.ts"))
  const hasAssetsDirectory = await pathExists(resolve(packagePath, "assets"))

  const dockerfile = createDockerfile({
    baseDockerfile,
    reside: config.reside,
    workspacePackages,
    replicaPath,
    hasChangelog,
    hasWorkflows,
    hasPrismaDirectory,
    hasPrismaConfig,
    hasAssetsDirectory,
  })
  args.logger.debug("generated Dockerfile:\n%s", dockerfile)

  if (!config.reside.image) {
    throw new Error("package.json reside.image is required to build an image")
  }

  const image = `${config.reside.image}:${args.tag}`

  if (args.push) {
    args.logger.info('building and pushing image "%s"', image)
  } else {
    args.logger.info('building image "%s"', image)
  }

  await runCommand(
    ["docker", "build", rootPath, "-f", "-", "-t", image, args.push ? ["--push"] : []].flat(),
    {
      commandLog: args.commandLog,
      input: dockerfile,
      passthroughOutput: args.interactiveDockerOutput === true,
    },
  )

  const resolvedImage = args.push
    ? await resolvePushedImageReference(image, args.commandLog)
    : image

  if (args.push) {
    args.logger.info("resolved pushed image to %s", resolvedImage)
    args.logger.info({ success: true }, "image built and pushed successfully")
  } else {
    args.logger.info({ success: true }, "image built successfully")
  }

  return resolvedImage
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function resolvePushedImageReference(
  image: string,
  commandLog?: CommandLog,
): Promise<string> {
  const output = await runCommand(
    ["docker", "image", "inspect", image, "--format", "{{json .RepoDigests}}"],
    {
      commandLog,
      logOutput: false,
    },
  )
  const repoDigests = parseRepoDigests(output)
  const repository = getImageRepository(image)

  for (const repoDigest of repoDigests) {
    if (repoDigest.startsWith(`${repository}@`)) {
      return repoDigest
    }
  }

  const firstRepoDigest = repoDigests[0]
  if (firstRepoDigest) {
    return firstRepoDigest
  }

  throw new Error(`Failed to resolve repo digest for pushed image "${image}"`)
}

function parseRepoDigests(output: string): string[] {
  const parsedValue: unknown = JSON.parse(output)
  if (!Array.isArray(parsedValue)) {
    throw new Error("Docker image inspect returned invalid RepoDigests payload")
  }

  const repoDigests: string[] = []

  for (const item of parsedValue) {
    if (typeof item !== "string") {
      throw new Error("Docker image inspect returned a non-string repo digest")
    }

    repoDigests.push(item)
  }

  return repoDigests
}

function getImageRepository(image: string): string {
  const digestSeparatorIndex = image.indexOf("@")
  if (digestSeparatorIndex >= 0) {
    return image.slice(0, digestSeparatorIndex)
  }

  const lastSlashIndex = image.lastIndexOf("/")
  const lastColonIndex = image.lastIndexOf(":")

  if (lastColonIndex > lastSlashIndex) {
    return image.slice(0, lastColonIndex)
  }

  return image
}
