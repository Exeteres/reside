import type { ResideLogger } from "./logger"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, relative, resolve } from "node:path"
import { loadResideManifest, RESIDE_MANIFEST_FILE } from "@reside/common"
import { createDockerfile } from "./docker"
import { loadPackageConfig } from "./package-config"
import { type CommandLog, runCommand } from "./process"
import { getRootPath, getWorkspacePackagePaths } from "./project"

export type BuildImageArgs = {
  commandLog?: CommandLog
  logger: ResideLogger
  tag?: string
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
  const manifest = await loadResideManifest(packagePath)
  const hasWorkflows = await pathExists(resolve(packagePath, "src/workflows/index.ts"))
  const hasAssetsDirectory = await pathExists(resolve(packagePath, "assets"))

  if (!manifest) {
    throw new Error(`${RESIDE_MANIFEST_FILE} with image and version is required to build an image`)
  }

  const dockerfile = createDockerfile({
    baseDockerfile,
    workspacePackages,
    replicaPath,
    hasChangelog,
    hasResideManifest: true,
    hasWorkflows,
    hasPrismaDirectory,
    hasPrismaConfig,
    hasAssetsDirectory,
  })
  args.logger.debug("generated Dockerfile:\n%s", dockerfile)

  const tag = await resolveBuildImageTag(packagePath, args.tag)
  const image = `${manifest.image}:${tag}`

  if (args.push) {
    args.logger.info('building and pushing image "%s"', image)
  } else {
    args.logger.info('building image "%s"', image)
  }

  const metadataDir = args.push ? await mkdtemp(join(tmpdir(), "reside-build-")) : undefined
  const metadataFile = metadataDir ? join(metadataDir, "metadata.json") : undefined

  try {
    await runCommand(
      [
        "docker",
        "build",
        rootPath,
        "-f",
        "-",
        "-t",
        image,
        createGithubActionsCacheArgs(),
        metadataFile ? ["--metadata-file", metadataFile] : [],
        args.push ? ["--push"] : [],
      ].flat(),
      {
        commandLog: args.commandLog,
        input: dockerfile,
        passthroughOutput: args.interactiveDockerOutput === true,
      },
    )

    const resolvedImage = args.push
      ? await resolvePushedImageReference(image, args.commandLog, metadataFile)
      : image

    if (args.push) {
      args.logger.info("resolved pushed image to %s", resolvedImage)
      args.logger.info({ success: true }, "image built and pushed successfully")
    } else {
      args.logger.info({ success: true }, "image built successfully")
    }

    return resolvedImage
  } finally {
    if (metadataDir) {
      await rm(metadataDir, { recursive: true, force: true })
    }
  }
}

export async function resolveBuildImageTag(
  packagePath: string,
  requestedTag?: string,
): Promise<string> {
  return requestedTag ?? (await loadResideManifest(packagePath))?.version ?? "latest"
}

export function createGithubActionsCacheArgs(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.GITHUB_ACTIONS !== "true") {
    return []
  }

  return ["--cache-from", "type=gha", "--cache-to", "type=gha,mode=max"]
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
  metadataFile?: string,
): Promise<string> {
  const metadataReference = metadataFile
    ? await resolveImageReferenceFromBuildMetadata(image, metadataFile)
    : undefined

  if (metadataReference) {
    return metadataReference
  }

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

export async function resolveImageReferenceFromBuildMetadata(
  image: string,
  metadataFile: string,
): Promise<string | undefined> {
  let content = ""

  try {
    content = await readFile(metadataFile, "utf8")
  } catch {
    return undefined
  }

  if (content.trim().length === 0) {
    return undefined
  }

  const parsedValue: unknown = JSON.parse(content)
  if (!parsedValue || typeof parsedValue !== "object" || Array.isArray(parsedValue)) {
    throw new Error("Docker build metadata returned an invalid payload")
  }

  const digest = (parsedValue as Record<string, unknown>)["containerimage.digest"]
  if (typeof digest !== "string" || digest.trim().length === 0) {
    return undefined
  }

  return `${getImageRepository(image)}@${digest.trim()}`
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
