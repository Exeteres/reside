import { copyFile, lstat, mkdir, readdir, readlink, rm, stat, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { bundleWorkflowCode } from "build-temporal-workflow"

type BuildReplicaArgs = {
  replicaPath: string
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const rootPath = process.cwd()
  const packagePath = resolve(rootPath, args.replicaPath)
  const distPath = resolve(packagePath, "dist")
  const runtimeOutputPath = resolve(distPath, "main")
  const workflowsSourcePath = resolve(packagePath, "src/workflows/index.ts")
  const prismaConfigSourcePath = resolve(packagePath, "prisma.config.ts")
  const prismaDirectoryPath = resolve(packagePath, "prisma")

  await rm(distPath, {
    recursive: true,
    force: true,
  })
  await mkdir(distPath, {
    recursive: true,
  })

  const runtimeResult = await Bun.build({
    root: packagePath,
    entrypoints: ["__reside_virtual_main.ts"],
    files: {
      "__reside_virtual_main.ts": createVirtualRuntimeMainSource(packagePath),
    },
    target: "bun",
    external: ["@temporalio/*"],
    bytecode: true,
    compile: {
      outfile: runtimeOutputPath,
      autoloadPackageJson: true,
    },
    format: "esm",
    sourcemap: "inline",
  })

  assertBuildResult(runtimeResult, "runtime artifact")

  if (await pathExists(workflowsSourcePath)) {
    const workflowsResult = await bundleWorkflowCode({
      workflowsPath: workflowsSourcePath,
    })

    await writeFile(resolve(distPath, "workflows.js"), workflowsResult.code, "utf8")
  }

  if (await pathExists(prismaConfigSourcePath)) {
    const prismaConfigResult = await Bun.build({
      root: packagePath,
      entrypoints: [prismaConfigSourcePath],
      external: ["@prisma/config"],
      target: "node",
      format: "esm",
      sourcemap: "inline",
      outdir: distPath,
    })

    assertBuildResult(prismaConfigResult, "prisma config artifact")
  }

  if (await pathExists(prismaDirectoryPath)) {
    await materializePrismaSymlinks(prismaDirectoryPath)
  }

  console.info(`Built replica artifacts in ${distPath}`)
}

async function materializePrismaSymlinks(path: string): Promise<void> {
  const entries = await readdir(path, {
    withFileTypes: true,
  })

  for (const entry of entries) {
    const entryPath = resolve(path, entry.name)

    if (entry.isDirectory()) {
      await materializePrismaSymlinks(entryPath)
      continue
    }

    const entryStat = await lstat(entryPath)
    if (!entryStat.isSymbolicLink()) {
      continue
    }

    const linkTarget = await readlink(entryPath)
    const resolvedTargetPath = resolve(dirname(entryPath), linkTarget)
    const targetStat = await stat(resolvedTargetPath)
    if (!targetStat.isFile()) {
      throw new Error(
        `Unsupported prisma symlink target for "${entryPath}": expected file, got "${resolvedTargetPath}"`,
      )
    }

    await copyFile(resolvedTargetPath, `${entryPath}.tmp`)
    await rm(entryPath, {
      force: true,
    })
    await copyFile(`${entryPath}.tmp`, entryPath)
    await rm(`${entryPath}.tmp`, {
      force: true,
    })
  }
}

function parseArgs(args: string[]): BuildReplicaArgs {
  let replicaPath: string | undefined

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]

    if (token === "--replica-path") {
      replicaPath = args[index + 1]
      index += 1
    }
  }

  if (!replicaPath) {
    throw new Error('Missing required "--replica-path" argument')
  }

  return {
    replicaPath,
  }
}

function assertBuildResult(result: Bun.BuildOutput, artifactName: string): void {
  if (result.success) {
    return
  }

  for (const logEntry of result.logs) {
    const locationPrefix = logEntry.position
      ? `${logEntry.position.file}:${logEntry.position.line}:${logEntry.position.column} `
      : ""

    console.error(`bun build failed (${artifactName}): ${locationPrefix}${logEntry.message}`)
  }

  throw new Error(`Failed to build ${artifactName} with Bun.build`)
}

function createVirtualRuntimeMainSource(packagePath: string): string {
  const bootstrapPath = resolve(packagePath, "src/bootstrap/main.ts")
  const replicaPath = resolve(packagePath, "src/replica/main.ts")
  const e2ePath = resolve(packagePath, "src/e2e/main.ts")

  return [
    'const resideBin = process.env.RESIDE_BIN ?? "bootstrap"',
    "",
    "switch (resideBin) {",
    '  case "bootstrap":',
    `    await import("${bootstrapPath}")`,
    "    break",
    '  case "replica":',
    `    await import("${replicaPath}")`,
    "    break",
    '  case "e2e":',
    `    await import("${e2ePath}")`,
    "    break",
    "  default:",
    '    throw new Error("Unsupported RESIDE_BIN " + resideBin)',
    "}",
  ].join("\n")
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

await main()
