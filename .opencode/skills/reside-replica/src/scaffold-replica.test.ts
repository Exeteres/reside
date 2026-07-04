import { afterEach, describe, expect, test } from "bun:test"
import { constants } from "node:fs"
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

const temporaryRoots: string[] = []

describe("scaffold-replica", () => {
  afterEach(async () => {
    for (const root of temporaryRoots.splice(0)) {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("creates target replica from source template", async () => {
    const root = await createTemporaryRepository()
    const scriptPath = path.join(import.meta.dir, "scaffold-replica.ts")

    const result = Bun.spawnSync({
      cmd: ["bun", scriptPath, "source", "target", "Тестовая реплика"],
      cwd: root,
      stderr: "pipe",
      stdout: "pipe",
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout.toString()).toContain("Created replicas/target from replicas/source")

    const targetDir = path.join(root, "replicas", "target")
    const packageJson = JSON.parse(await readFile(path.join(targetDir, "package.json"), "utf8"))
    const manifest = JSON.parse(
      await readFile(path.join(targetDir, "reside.manifest.json"), "utf8"),
    )
    const changelog = await readFile(path.join(targetDir, "CHANGELOG.md"), "utf8")
    const main = await readFile(path.join(targetDir, "src", "replica", "main.ts"), "utf8")
    const business = await readFile(
      path.join(targetDir, "src", "replica", "business", "target.ts"),
      "utf8",
    )

    expect(packageJson.name).toBe("@replicas/target")
    expect(packageJson.scripts.generate).toBe("prisma generate")
    expect(manifest).toEqual({
      version: "0.1.0",
      image: "ghcr.io/exeteres/reside/replicas/target",
    })
    expect(changelog).toContain("Создана начальная версия Тестовая реплика.")
    expect(main).toContain("Target target targetCommand @replicas/target")
    expect(business).toContain("targetFeature")

    await expectPathMissing(path.join(targetDir, "node_modules"))
    await expectPathMissing(path.join(targetDir, "src", "database", "_generated"))
    await expectPathMissing(path.join(targetDir, "src", "replica", "business", "source.ts"))
    await expectPathMissing(path.join(targetDir, "prisma", "source.prisma"))
    await expectPathMissing(path.join(targetDir, "src", "source-feature"))
    await expectPathExists(path.join(targetDir, "prisma", "target.prisma"))
    await expectPathExists(path.join(targetDir, "src", "target-feature", "target.ts"))
    await expectPathMissing(path.join(targetDir, "prisma", "migrations", "old", "migration.sql"))
    await expectPathExists(path.join(targetDir, "prisma", "migrations", "migration_lock.toml"))

    await expect(readlink(path.join(targetDir, "prisma", "memory.prisma"))).resolves.toBe(
      "../../../packages/common/prisma/memory.prisma",
    )
  })
})

async function createTemporaryRepository(): Promise<string> {
  const root = await mktemp()
  temporaryRoots.push(root)

  await writeFile(path.join(root, "README.md"), "# Test\n", "utf8")
  await writeFile(path.join(root, "AGENTS.md"), "# Test\n", "utf8")

  const sourceDir = path.join(root, "replicas", "source")
  await mkdir(path.join(sourceDir, "src", "replica", "business"), { recursive: true })
  await mkdir(path.join(sourceDir, "src", "source-feature"), { recursive: true })
  await mkdir(path.join(sourceDir, "src", "database", "_generated"), { recursive: true })
  await mkdir(path.join(sourceDir, "prisma", "migrations", "old"), { recursive: true })
  await mkdir(path.join(sourceDir, "node_modules", "ignored"), { recursive: true })

  await writeFile(
    path.join(sourceDir, "package.json"),
    `${JSON.stringify(
      {
        name: "@replicas/source",
        exports: { "./package.json": "./package.json" },
        scripts: { generate: "prisma generate" },
      },
      null,
      2,
    )}\n`,
    "utf8",
  )
  await writeFile(
    path.join(sourceDir, "reside.manifest.json"),
    `${JSON.stringify({ version: "9.9.9", image: "old" }, null, 2)}\n`,
    "utf8",
  )
  await writeFile(path.join(sourceDir, "CHANGELOG.md"), "# Changelog\n\nold\n", "utf8")
  await writeFile(
    path.join(sourceDir, "src", "replica", "main.ts"),
    "export const sourceCommand = 'Source source sourceCommand @replicas/source'\n",
    "utf8",
  )
  await writeFile(
    path.join(sourceDir, "src", "replica", "business", "source.ts"),
    "export const sourceFeature = 'source'\n",
    "utf8",
  )
  await writeFile(
    path.join(sourceDir, "src", "source-feature", "source.ts"),
    "export const sourceFeature = 'source'\n",
    "utf8",
  )
  await writeFile(path.join(sourceDir, "prisma", "source.prisma"), "model Source {}\n", "utf8")
  await writeFile(
    path.join(sourceDir, "src", "database", "_generated", "client.ts"),
    "generated",
    "utf8",
  )
  await writeFile(
    path.join(sourceDir, "prisma", "migrations", "old", "migration.sql"),
    "old migration",
    "utf8",
  )
  await symlink(
    "../../../packages/common/prisma/memory.prisma",
    path.join(sourceDir, "prisma", "memory.prisma"),
  )

  return root
}

async function mktemp(): Promise<string> {
  const template = path.join(tmpdir(), "reside-scaffold-test-")
  return await mkdtemp(template)
}

async function expectPathExists(filePath: string): Promise<void> {
  await access(filePath, constants.F_OK)
}

async function expectPathMissing(filePath: string): Promise<void> {
  await expect(access(filePath, constants.F_OK)).rejects.toThrow()
}
