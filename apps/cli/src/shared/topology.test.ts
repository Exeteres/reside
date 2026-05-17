import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { topology } from "@reside/registry"
import {
  resolveDataValues,
  resolveReplicaSelection,
  sanitizeEndpointName,
  substituteEnvironmentReferences,
} from "./topology"

describe("resolveReplicaSelection", () => {
  test("includes dependencies while preserving the provided sorted order", () => {
    const replicas = resolveReplicaSelection(topology, ["alpha"])

    expect(replicas.map(replica => replica.name)).toEqual(["infra", "access", "telegram", "alpha"])
  })

  test("selects only requested replicas when dependency expansion is disabled", () => {
    const replicas = resolveReplicaSelection(topology, ["alpha"], {
      includeDependencies: false,
    })

    expect(replicas.map(replica => replica.name)).toEqual(["alpha"])
  })
})

describe("environment substitution", () => {
  test("replaces multiple placeholders", async () => {
    const result = await substituteEnvironmentReferences(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: placeholder syntax is intentional in this test
      "postgres://$DB_USER:${DB_PASSWORD}@${DB_HOST}:5432/app",
      async variableName => `value-for-${variableName}`,
    )

    expect(result).toBe(
      "postgres://value-for-DB_USER:value-for-DB_PASSWORD@value-for-DB_HOST:5432/app",
    )
  })

  test("resolves mapping values", async () => {
    const result = await resolveDataValues(
      {
        bot_token: "$BOT_TOKEN",
        // biome-ignore lint/suspicious/noTemplateCurlyInString: placeholder syntax is intentional in this test
        webhook: "https://${HOST}/hook",
      },
      async variableName => variableName.toLowerCase(),
    )

    expect(result).toEqual({
      bot_token: "bot_token",
      webhook: "https://host/hook",
    })
  })

  test("loads file content from $file environment reference", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "reside-topology-test-"))
    const privateKeyPath = join(tempDir, "private-key.pem")
    const privateKeyContent = "line-one\nline-two\n"

    try {
      await writeFile(privateKeyPath, privateKeyContent, "utf8")

      const result = await substituteEnvironmentReferences(
        "$file:ENGINEER_GITHUB_APP_PRIVATE_KEY",
        async variableName => {
          if (variableName !== "ENGINEER_GITHUB_APP_PRIVATE_KEY") {
            throw new Error(`Unexpected variable name: ${variableName}`)
          }

          return privateKeyPath
        },
      )

      expect(result).toBe(privateKeyContent)
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})

describe("sanitizeEndpointName", () => {
  test("replaces dots with dashes", () => {
    expect(sanitizeEndpointName("reside.common.interaction.v1")).toBe(
      "reside-common-interaction-v1",
    )
  })
})
