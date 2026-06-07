import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveBuildImageTag } from "./build-image"

describe("resolveBuildImageTag", () => {
  test("uses requested tag when provided", async () => {
    const packagePath = await mkdtemp(join(tmpdir(), "reside-build-tag-"))

    try {
      await writeFile(
        join(packagePath, "reside.manifest.json"),
        JSON.stringify({
          version: "1.2.3",
          image: "ghcr.io/exeteres/reside/replicas/test",
        }),
        "utf8",
      )

      await expect(resolveBuildImageTag(packagePath, "custom")).resolves.toBe("custom")
    } finally {
      await rm(packagePath, { recursive: true, force: true })
    }
  })

  test("uses manifest version when no tag is provided", async () => {
    const packagePath = await mkdtemp(join(tmpdir(), "reside-build-tag-"))

    try {
      await writeFile(
        join(packagePath, "reside.manifest.json"),
        JSON.stringify({
          version: "1.2.3",
          image: "ghcr.io/exeteres/reside/replicas/test",
        }),
        "utf8",
      )

      await expect(resolveBuildImageTag(packagePath)).resolves.toBe("1.2.3")
    } finally {
      await rm(packagePath, { recursive: true, force: true })
    }
  })

  test("falls back to latest when manifest is missing", async () => {
    const packagePath = await mkdtemp(join(tmpdir(), "reside-build-tag-"))

    try {
      await expect(resolveBuildImageTag(packagePath)).resolves.toBe("latest")
    } finally {
      await rm(packagePath, { recursive: true, force: true })
    }
  })
})
