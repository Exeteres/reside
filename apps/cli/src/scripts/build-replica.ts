import { mkdir, rm, stat, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
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
  const workflowsSourcePath = resolve(packagePath, "src/workflows/main.ts")
  const prismaConfigSourcePath = resolve(packagePath, "prisma.config.ts")

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

  console.info(`Built replica artifacts in ${distPath}`)
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
