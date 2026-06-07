import { describe, expect, test } from "bun:test"
import { createDockerfile } from "./docker"

describe("createDockerfile", () => {
  const baseArgs = {
    baseDockerfile: "FROM scratch",
    workspacePackages: [
      {
        name: "@replicas/test",
        path: "replicas/test",
      },
    ],
    replicaPath: "replicas/test",
    hasResideManifest: false,
    hasWorkflows: false,
    hasPrismaDirectory: false,
    hasPrismaConfig: false,
    hasAssetsDirectory: false,
  }

  test("copies changelog into runtime image when replica has changelog", () => {
    const dockerfile = createDockerfile({
      ...baseArgs,
      hasChangelog: true,
    })

    expect(dockerfile).toContain(
      "COPY --from=build /app/replicas/test/CHANGELOG.md /app/CHANGELOG.md",
    )
  })

  test("does not copy changelog when replica has no changelog", () => {
    const dockerfile = createDockerfile({
      ...baseArgs,
      hasChangelog: false,
    })

    expect(dockerfile).not.toContain(
      "COPY --from=build /app/replicas/test/CHANGELOG.md /app/CHANGELOG.md",
    )
  })

  test("copies reside manifest into runtime image when replica has manifest", () => {
    const dockerfile = createDockerfile({
      ...baseArgs,
      hasChangelog: false,
      hasResideManifest: true,
    })

    expect(dockerfile).toContain(
      "COPY --from=build /app/replicas/test/reside.manifest.json /app/reside.manifest.json",
    )
  })
})
