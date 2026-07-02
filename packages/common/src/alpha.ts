import type { Replica } from "@reside/registry"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { RegistrationService } from "@reside/api/alpha/registration.v1"
import { alphaReplica, getAllDependencies } from "@reside/registry"
import { createChannel, createClient } from "./api"
import { getReplicaEndpoint } from "./kubernetes"
import { logger } from "./logger"
import { loadResideManifest } from "./manifest"

export type RegisterReplicaOptions<TReplica extends Replica = Replica> = {
  replica: TReplica
  title: string
  description: string
  version?: string
  changes?: string
}

type ReplicaReleaseMetadata = {
  version: string | undefined
  changes: string | undefined
}

/**
 * Registers the current replica in Alpha using its current internal endpoint.
 *
 * If registration fails, the error is logged and not retried.
 *
 * @param options The registration options.
 */
export async function registerReplica<TReplica extends Replica>({
  replica,
  title,
  description,
  version,
  changes,
}: RegisterReplicaOptions<TReplica>): Promise<void> {
  try {
    const metadata = await loadReplicaReleaseMetadata(process.cwd())

    const channel = createChannel(alphaReplica.endpoint)

    const allDependencies = getAllDependencies(replica)
    const allEndpoints = replica.endpoints

    const replicaDependencies = Object.entries(allDependencies).map(
      ([name, dependencyReplica]) => ({
        name,
        defaultReplicaName: dependencyReplica.name,
      }),
    )

    const endpointDependencies = Object.entries(allEndpoints).map(([name, endpoint]) => ({
      name,
      defaultEndpoint: endpoint,
    }))

    const registrationService = createClient(RegistrationService, channel)

    logger.info('registering replica "%s" in alpha', replica.name)

    try {
      await registrationService.registerReplica({
        title,
        description,
        internalEndpoint: getReplicaEndpoint(),
        replicaDependencies,
        endpointDependencies,
        version: version?.trim() || metadata.version,
        changes:
          (version?.trim() || metadata.version) !== undefined
            ? changes?.trim() || metadata.changes
            : undefined,
      })
    } catch (error) {
      throw new Error(`Failed to register replica "${replica.name}" in Alpha`, {
        cause: normalizeError(error),
      })
    }

    logger.info('replica "%s" was registered in alpha successfully', replica.name)
  } catch (error) {
    logger.error(
      { error: normalizeError(error) },
      'failed to register replica "%s" in alpha, not retrying',
      replica.name,
    )
  }
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error
  }

  return new Error(String(error))
}

async function loadReplicaReleaseMetadata(cwd: string): Promise<ReplicaReleaseMetadata> {
  const changelogPath = path.join(cwd, "CHANGELOG.md")

  const [manifest, changes] = await Promise.all([
    loadResideManifest(cwd),
    loadLatestChangelogEntry(changelogPath),
  ])

  return {
    version: manifest?.version,
    changes,
  }
}

async function loadLatestChangelogEntry(changelogPath: string): Promise<string | undefined> {
  try {
    const content = await readFile(changelogPath, "utf8")
    return extractLatestChangelogEntry(content)
  } catch {
    return undefined
  }
}

export function extractLatestChangelogEntry(changelog: string): string | undefined {
  const normalized = changelog.replace(/\r\n/g, "\n")
  const firstSectionStart = normalized.search(/^##\s+/m)
  if (firstSectionStart === -1) {
    return undefined
  }

  const remaining = normalized.slice(firstSectionStart)
  const nextSectionOffset = remaining.slice(1).search(/\n##\s+/m)
  const firstSection =
    nextSectionOffset === -1 ? remaining : remaining.slice(0, nextSectionOffset + 1)

  const body = firstSection.replace(/^##\s+.+$/m, "").trim()
  return body.length > 0 ? body : undefined
}
