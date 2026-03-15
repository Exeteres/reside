import type { ResidePackageMetadata } from "./package-config"
import type { WorkspacePackagePath } from "./project"

export type CreateDockerfileArgs = {
  baseDockerfile: string
  reside: ResidePackageMetadata
  workspacePackages: WorkspacePackagePath[]
  replicaPath: string
  hasWorkflows: boolean
  hasPrismaDirectory: boolean
  hasPrismaConfig: boolean
  hasAssetsDirectory: boolean
}

export function createDockerfile(args: CreateDockerfileArgs): string {
  const prefixLines = args.baseDockerfile.trimEnd().split("\n")

  const lines: string[] = []

  lines.push("FROM oven/bun:1.3.10 AS deps")
  lines.push("")
  lines.push("WORKDIR /app")

  lines.push("")
  lines.push("# copy root workspace package manager files")
  lines.push("COPY package.json bun.lock bunfig.toml tsconfig.base.json /app/")
  lines.push("COPY patches/ /app/patches/")

  lines.push("")
  lines.push("# copy package.json for all workspace packages")
  for (const pkg of args.workspacePackages) {
    lines.push(`COPY ${pkg.path}/package.json /app/${pkg.path}/package.json`)
  }

  lines.push("")
  lines.push("# install production dependencies")
  lines.push("RUN bun install --production --ignore-scripts --linker hoisted")

  lines.push("")
  lines.push("FROM oven/bun:1.3.10 AS build")
  lines.push("")
  lines.push("WORKDIR /app")

  lines.push("")
  lines.push("# copy root workspace package manager files")
  lines.push("COPY package.json bun.lock bunfig.toml tsconfig.base.json /app/")
  lines.push("COPY patches/ /app/patches/")

  lines.push("")
  lines.push("# copy package.json for all workspace packages")
  for (const pkg of args.workspacePackages) {
    lines.push(`COPY ${pkg.path}/package.json /app/${pkg.path}/package.json`)
  }

  lines.push("")
  lines.push("# install all dependencies for build")
  lines.push("RUN bun install --ignore-scripts --linker hoisted")

  lines.push("")
  lines.push("# copy full workspace sources and build replica artifacts inside container")
  lines.push("COPY . /app/")
  lines.push(`RUN bun apps/cli/src/scripts/build-replica.ts --replica-path ${args.replicaPath}`)

  lines.push("")
  lines.push("# final stage")
  lines.push(...prefixLines)

  lines.push("")
  lines.push("WORKDIR /app")

  lines.push("")
  lines.push("# copy hoisted dependencies")
  lines.push("COPY --from=deps /app/node_modules /app/node_modules")

  lines.push("")
  lines.push("# copy app metadata and runtime resources")
  lines.push(`COPY --from=build /app/${args.replicaPath}/package.json /app/package.json`)

  if (args.hasPrismaConfig) {
    lines.push(
      `COPY --from=build /app/${args.replicaPath}/dist/prisma.config.js /app/prisma.config.js`,
    )
  }

  if (args.hasPrismaDirectory) {
    lines.push(`COPY --from=build /app/${args.replicaPath}/prisma/ /app/prisma/`)
  }

  if (args.hasAssetsDirectory) {
    lines.push(`COPY --from=build /app/${args.replicaPath}/assets/ /app/assets/`)
  }

  lines.push("")
  lines.push("# copy compiled runtime artifact")
  lines.push(`COPY --from=build /app/${args.replicaPath}/dist/main /app/main`)

  if (args.hasWorkflows) {
    lines.push(`COPY --from=build /app/${args.replicaPath}/dist/workflows.js /app/workflows.js`)
  }

  if (args.reside.image === undefined) {
    throw new Error("package.json reside.image is required to build an image")
  }

  lines.push("")
  lines.push("# app runtime")
  lines.push('CMD ["/app/main"]')

  return lines.join("\n")
}
