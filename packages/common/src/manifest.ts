import { readFile } from "node:fs/promises"
import path from "node:path"

export const RESIDE_MANIFEST_FILE = "reside.manifest.json"

export type ResideManifest = {
  version: string
  image: string
  extraComponents: string[]
}

/**
 * Loads the ReSide manifest from the given package/runtime directory.
 *
 * @param cwd The directory containing the manifest file.
 * @returns The manifest when it exists and is valid.
 */
export async function loadResideManifest(cwd: string): Promise<ResideManifest | undefined> {
  try {
    const manifestPath = path.join(cwd, RESIDE_MANIFEST_FILE)
    const content = await readFile(manifestPath, "utf8")
    return parseResideManifest(content)
  } catch {
    return undefined
  }
}

export function parseResideManifest(content: string): ResideManifest | undefined {
  const parsed = JSON.parse(content) as {
    version?: unknown
    image?: unknown
    extraComponents?: unknown
  }

  if (typeof parsed.version !== "string") {
    return undefined
  }

  if (typeof parsed.image !== "string") {
    return undefined
  }

  const version = parsed.version.trim()
  if (version.length === 0) {
    return undefined
  }

  const image = parsed.image.trim()
  if (image.length === 0) {
    return undefined
  }

  const extraComponents = parseExtraComponents(parsed.extraComponents)
  if (!extraComponents) {
    return undefined
  }

  return { version, image, extraComponents }
}

function parseExtraComponents(value: unknown): string[] | undefined {
  if (value === undefined) {
    return []
  }

  if (!Array.isArray(value)) {
    return undefined
  }

  const components = value.map(component => {
    return typeof component === "string" ? component.trim() : ""
  })

  if (components.some(component => component.length === 0)) {
    return undefined
  }

  return components
}
