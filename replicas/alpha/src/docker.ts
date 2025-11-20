import { ResideManifest } from "@reside/shared"
import { prettifyError } from "zod"

/**
 * Fetches the digest of a docker image tag.
 *
 * @param image The docker image tag in arbitrary format.
 * @returns The digest string.
 */
export async function fetchImageDigest(image: string): Promise<string> {
  const command = Bun.spawn(["regctl", "image", "digest", image], { stderr: "pipe" })

  const exitCode = await command.exited

  if (exitCode !== 0) {
    const stderr = await command.stderr.text()

    throw new Error(`Failed to fetch digest for "${image}": ${stderr}`)
  }

  const stdout = await command.stdout.text()
  return stdout.trim()
}

/**
 * Fetches the reside manifest from a docker image tag.
 *
 * Throws an error if the manifest cannot be fetched or is invalid.
 *
 * Requires `regctl` to be installed and available in PATH.
 *
 * @param image The docker image tag in arbitrary format.
 * @returns The reside manifest.
 */
export async function fetchResideManifest(image: string): Promise<ResideManifest> {
  const command = Bun.spawn(
    [
      "regctl",
      "image",
      "config",
      image,
      "--format",
      `'{{ index .Config.Labels "io.reside.manifest" }}`,
    ],
    { stderr: "pipe" },
  )

  const exitCode = await command.exited

  if (exitCode !== 0) {
    const stderr = await command.stderr.text()

    throw new Error(`Failed to fetch reside manifest for "${image}": ${stderr}`)
  }

  const stdout = await command.stdout.text()
  const json = Buffer.from(stdout, "base64").toString("utf-8")

  if (!json) {
    throw new Error(`Reside manifest not found in image labels for "${image}"`)
  }

  let manifest: ResideManifest
  try {
    manifest = JSON.parse(json)
  } catch (error) {
    throw new Error(`Failed to parse reside manifest for "${image}": ${error}`)
  }

  const safeResult = ResideManifest.safeParse(manifest)
  if (!safeResult.success) {
    throw new Error(`Reside manifest for "${image}" is invalid: ${prettifyError(safeResult.error)}`)
  }

  return safeResult.data
}

export type ParsedImage = {
  /**
   * The first part of the image before the colon.
   *
   * Example: ghcr.io/exeteres/reside/contracts/alpha.v1
   */
  identity: string

  /**
   * The tag part of the image after the colon.
   * Can be undefined if no tag is provided.
   *
   * Example: latest
   */
  tag?: string

  /**
   * The digest part of the image after the @ symbol.
   * Can be undefined if no digest is provided.
   */
  digest?: string
}

/**
 * Parses a docker image string into its components.
 *
 * @param image The full image string.
 * @returns The parsed image components.
 */
export function parseImage(image: string): ParsedImage {
  const digestIndex = image.indexOf("@")
  const referenceEnd = digestIndex === -1 ? image.length : digestIndex
  const lastSlashIndex = image.lastIndexOf("/", referenceEnd - 1)
  const tagSearchStart = lastSlashIndex === -1 ? 0 : lastSlashIndex + 1
  const tagSection = image.slice(tagSearchStart, referenceEnd)
  const colonInTagSection = tagSection.indexOf(":")
  const tagIndex = colonInTagSection === -1 ? -1 : tagSearchStart + colonInTagSection

  const identityEndIndex = tagIndex !== -1 ? tagIndex : referenceEnd
  const identity = image.substring(0, identityEndIndex)

  let tag: string | undefined
  let digest: string | undefined

  if (tagIndex !== -1) {
    const tagEndIndex = digestIndex !== -1 ? digestIndex : image.length
    tag = image.substring(tagIndex + 1, tagEndIndex)
  }

  if (digestIndex !== -1) {
    digest = image.substring(digestIndex + 1)
  }

  return {
    identity,
    tag,
    digest,
  }
}

/**
 * Formats a ParsedImage back into a docker image string.
 *
 * @param parsed The parsed image components.
 * @returns The full image string.
 */
export function formatImage(parsed: ParsedImage): string {
  let image = parsed.identity

  if (parsed.tag) {
    image += `:${parsed.tag}`
  }

  if (parsed.digest) {
    image += `@${parsed.digest}`
  }

  return image
}
