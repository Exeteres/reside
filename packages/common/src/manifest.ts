import { readFile } from "node:fs/promises"
import path from "node:path"

export const RESIDE_MANIFEST_FILE = "reside.manifest.json"

export type ResideManifest = {
  version: string
  image: string
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

  return { version, image }
}
