import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  createGithubActionsCacheArgs,
  resolveBuildImageTag,
  resolveImageReferenceFromBuildMetadata,
} from "./build-image"

describe("createGithubActionsCacheArgs", () => {
  test("returns gha cache flags on github actions", () => {
    expect(createGithubActionsCacheArgs({ GITHUB_ACTIONS: "true" })).toEqual([
      "--cache-from",
      "type=gha",
      "--cache-to",
      "type=gha,mode=max",
    ])
  })

  test("returns no cache flags outside github actions", () => {
    expect(createGithubActionsCacheArgs({})).toEqual([])
  })
})

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

describe("resolveImageReferenceFromBuildMetadata", () => {
  test("resolves pushed image digest from build metadata", async () => {
    const packagePath = await mkdtemp(join(tmpdir(), "reside-build-metadata-"))
    const metadataPath = join(packagePath, "metadata.json")

    try {
      await writeFile(
        metadataPath,
        JSON.stringify({
          "containerimage.digest": "sha256:abc123",
        }),
        "utf8",
      )

      await expect(
        resolveImageReferenceFromBuildMetadata(
          "ghcr.io/exeteres/reside/replicas/test:1.2.3",
          metadataPath,
        ),
      ).resolves.toBe("ghcr.io/exeteres/reside/replicas/test@sha256:abc123")
    } finally {
      await rm(packagePath, { recursive: true, force: true })
    }
  })

  test("returns undefined when build metadata has no digest", async () => {
    const packagePath = await mkdtemp(join(tmpdir(), "reside-build-metadata-"))
    const metadataPath = join(packagePath, "metadata.json")

    try {
      await writeFile(metadataPath, JSON.stringify({}), "utf8")

      await expect(
        resolveImageReferenceFromBuildMetadata(
          "ghcr.io/exeteres/reside/replicas/test:1.2.3",
          metadataPath,
        ),
      ).resolves.toBeUndefined()
    } finally {
      await rm(packagePath, { recursive: true, force: true })
    }
  })
})
