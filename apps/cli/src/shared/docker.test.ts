import { describe, expect, test } from "bun:test"
import { createDockerfile } from "./docker"

const runtimePathLine = 'ENV PATH="/app/node_modules/.bin:$' + '{PATH}"'

describe("createDockerfile", () => {
  const baseArgs = {
    runtimeDockerfile: "FROM scratch",
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
    hasOpenCodeConfig: false,
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

  test("does not include nix or devenv runtime setup", () => {
    const dockerfile = createDockerfile({
      ...baseArgs,
      hasChangelog: false,
    })

    expect(dockerfile).not.toContain("nix profile")
    expect(dockerfile).not.toContain(".nix-profile")
    expect(dockerfile).not.toContain("devenv shell")
  })

  test("copies opencode config into runtime image when present", () => {
    const dockerfile = createDockerfile({
      ...baseArgs,
      hasChangelog: false,
      hasOpenCodeConfig: true,
    })

    expect(dockerfile).toContain(
      "COPY --from=build /app/.opencode/opencode.json /app/.opencode/opencode.json",
    )
  })

  test("adds workspace binary directory to runtime path", () => {
    const dockerfile = createDockerfile({
      ...baseArgs,
      hasChangelog: false,
    })

    expect(dockerfile).toContain(runtimePathLine)
  })

  test("runs opencode postinstall in production dependencies", () => {
    const dockerfile = createDockerfile({
      ...baseArgs,
      hasChangelog: false,
    })

    expect(dockerfile).toContain("RUN cd node_modules/opencode-ai && node postinstall.mjs")
  })

  test("embeds shared runtime stage before app runtime setup", () => {
    const dockerfile = createDockerfile({
      ...baseArgs,
      hasChangelog: false,
    })

    expect(dockerfile).toContain("# runtime stage\nFROM scratch")
    expect(dockerfile).toContain("FROM scratch\n\nWORKDIR /app")
  })

  test("appends package runtime dockerfile after shared runtime", () => {
    const dockerfile = createDockerfile({
      ...baseArgs,
      hasChangelog: false,
      customRuntimeDockerfile: "RUN apt-get update",
    })

    expect(dockerfile).toContain("# runtime stage\nFROM scratch")
    expect(dockerfile).toContain("# custom runtime setup\nRUN apt-get update")
    expect(dockerfile).toContain("RUN apt-get update\n\nWORKDIR /app")
  })

  test("builds and copies shared runtime artifact", () => {
    const dockerfile = createDockerfile({
      ...baseArgs,
      hasChangelog: false,
    })

    expect(dockerfile).toContain(
      "RUN bun apps/cli/src/scripts/build-replica.ts --replica-path replicas/test",
    )
    expect(dockerfile).not.toContain("--component")
    expect(dockerfile).toContain("COPY --from=build /app/replicas/test/dist/main /app/main")
  })
})
