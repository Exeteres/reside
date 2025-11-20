import type { ResideManifest } from "@reside/shared"
import type { IncludedPackage } from "./project"
import type { Logger } from "pino"

const from =
  "oven/bun:1.3.0-alpine@sha256:37e6b1cbe053939bccf6ae4507977ed957eaa6e7f275670b72ad6348e0d2c11f"

export function createDockerfile(
  manifest: ResideManifest,
  includedPackages: IncludedPackage[],
  logger: Logger,
): string {
  if (manifest.type === "contract") {
    return createContractDockerfile(manifest)
  }

  return createReplicaDockerfile(manifest, includedPackages, logger)
}

function createReplicaDockerfile(
  manifest: ResideManifest,
  includedPackages: IncludedPackage[],
  logger: Logger,
): string {
  const lastPackage = includedPackages[includedPackages.length - 1]
  if (!lastPackage) {
    throw new Error("No packages to include in the Dockerfile")
  }

  logger.info(`including %d packages in the build`, includedPackages.length)

  const lines: string[] = []

  lines.push(`FROM ${from}`)

  if (manifest.packages && manifest.packages.length > 0) {
    lines.push("")
    lines.push("# install extra alpine packages")
    lines.push(`RUN apk add --no-cache ${manifest.packages.map(pkg => pkg.trim()).join(" ")}`)
  }

  if (manifest.testingPackages && manifest.testingPackages.length > 0) {
    lines.push("")
    lines.push("# install extra alpine packages from testing repository")
    lines.push(
      `RUN apk add --no-cache ${manifest.testingPackages
        .map(pkg => pkg.trim())
        .join(" ")} --repository=http://dl-cdn.alpinelinux.org/alpine/edge/testing`,
    )
  }

  lines.push("")
  lines.push("WORKDIR /app")

  lines.push("")
  lines.push("# copy root woskpace files")
  lines.push("COPY package.json bun.lock bunfig.toml tsconfig.base.json /app/")
  lines.push("COPY patches/ /app/patches/")

  lines.push("")
  lines.push(createDependencyInstallStep(lastPackage.name, includedPackages))

  lines.push("")
  lines.push(createSourceCopyStep(includedPackages))

  lines.push("")
  lines.push(createFinalCommandStep(lastPackage.path))

  lines.push("")
  lines.push(createManifestLabelStep(manifest))

  return lines.join("\n")
}

function createContractDockerfile(manifest: ResideManifest): string {
  const lines: string[] = []

  lines.push(`FROM scratch`)

  lines.push("")
  lines.push(createManifestLabelStep(manifest))

  return lines.join("\n")
}

function createManifestLabelStep(manifest: ResideManifest): string {
  const serialiazedManifest = Buffer.from(JSON.stringify(manifest)).toBase64()
  const comment = "# embed reside manifest as a label"
  const label = `LABEL io.reside.manifest="${serialiazedManifest}"`

  return `${comment}\n${label}`
}

function createDependencyInstallStep(
  packageName: string,
  includedPackages: IncludedPackage[],
): string {
  const lines: string[] = ["# copy package.json for all included packages and install dependencies"]

  for (const pkg of includedPackages) {
    lines.push(`COPY ${pkg.path}/package.json /app/${pkg.path}/package.json`)
  }

  lines.push("")
  lines.push(`RUN bun install --filter ${packageName} --ignore-scripts`)

  return lines.join("\n")
}

function createSourceCopyStep(includedPackages: IncludedPackage[]): string {
  const lines: string[] = ["# copy source code for all included packages"]

  for (const pkg of includedPackages) {
    lines.push(`COPY ${pkg.path}/ /app/${pkg.path}/`)
  }

  return lines.join("\n")
}

function createFinalCommandStep(path: string): string {
  const comment = "# final command to run the replica"
  const command = `CMD ["bun", "${path}/src/main.ts"]`

  return `${comment}\n${command}`
}
