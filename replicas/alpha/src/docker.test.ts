import { describe, expect, test } from "bun:test"
import { fetchImageDigest, fetchResideManifest, parseImage } from "./docker"

describe("fetchImageDigest", () => {
  test(
    "fetch image digest",
    async () => {
      const expected = "sha256:bc9b603c90e9a9f2af9c4de3352a521f6b68eb0466ed65e0103b8e92cfc3af06"
      const image = `ghcr.io/exeteres/reside/contracts/alpha.v1:latest@${expected}`

      const digest = await fetchImageDigest(image)

      expect(digest).toBe(expected)
    },
    { timeout: 10_000 },
  )
})

describe("fetchResideManifest", () => {
  test(
    "fetch contract manifest",
    async () => {
      const image =
        "ghcr.io/exeteres/reside/contracts/alpha.v1@sha256:bc9b603c90e9a9f2af9c4de3352a521f6b68eb0466ed65e0103b8e92cfc3af06"

      const manifest = await fetchResideManifest(image)

      expect(manifest).toMatchSnapshot()
    },
    { timeout: 10_000 },
  )

  test(
    "fetch replica manifest",
    async () => {
      const image =
        "ghcr.io/exeteres/reside/replicas/alpha@sha256:e94a4a90d72c587f9c682b6e4b0c6b1cc7218ed46953275cddaf58100b35d693"

      const manifest = await fetchResideManifest(image)

      expect(manifest).toMatchSnapshot()
    },
    { timeout: 10_000 },
  )
})

describe("parseImage", () => {
  test("parses image without tag", () => {
    const image = "ghcr.io/exeteres/reside/contracts/alpha.v1"
    const parsed = parseImage(image)

    expect(parsed).toEqual({
      identity: "ghcr.io/exeteres/reside/contracts/alpha.v1",
      tag: undefined,
      digest: undefined,
    })
  })

  test("parses image with tag", () => {
    const image = "ghcr.io/exeteres/reside/contracts/alpha.v1:latest"
    const parsed = parseImage(image)

    expect(parsed).toEqual({
      identity: "ghcr.io/exeteres/reside/contracts/alpha.v1",
      tag: "latest",
      digest: undefined,
    })
  })

  test("parses image with digest", () => {
    const image = "ghcr.io/exeteres/reside/contracts/alpha.v1@sha256:abcdef"
    const parsed = parseImage(image)

    expect(parsed).toEqual({
      identity: "ghcr.io/exeteres/reside/contracts/alpha.v1",
      tag: undefined,
      digest: "sha256:abcdef",
    })
  })

  test("parses image with tag and digest", () => {
    const image = "ghcr.io/exeteres/reside/contracts/alpha.v1:latest@sha256:abcdef"
    const parsed = parseImage(image)

    expect(parsed).toEqual({
      identity: "ghcr.io/exeteres/reside/contracts/alpha.v1",
      tag: "latest",
      digest: "sha256:abcdef",
    })
  })
})
