import type { CustomObjectsApi } from "@kubernetes/client-node"

export const REPLICA_API_GROUP = "reside.io"
export const REPLICA_API_VERSION = "v1"
export const REPLICA_PLURAL = "replicas"

type ReplicaDependencySlotForResolution = {
  name: string
  currentReplica: {
    internalEndpoint: string
  } | null
}

type EndpointDependencySlotForResolution = {
  name: string
  defaultEndpoint: string | null
  currentEndpoint: string | null
}

export type ReplicaForDesiredEndpoints = {
  name: string
  image: string | null
  replicaDependencySlots: ReplicaDependencySlotForResolution[]
  endpointDependencySlots: EndpointDependencySlotForResolution[]
}

export function resolveDesiredReplicaEndpoints(
  replica: ReplicaForDesiredEndpoints,
): Record<string, string> {
  const replicaEndpointsBySlotName = new Map<string, string>()

  for (const slot of replica.replicaDependencySlots) {
    const endpoint = slot.currentReplica?.internalEndpoint
    if (endpoint === undefined) {
      continue
    }

    replicaEndpointsBySlotName.set(slot.name, endpoint)
  }

  const endpoints: Record<string, string> = {}

  for (const slot of replica.endpointDependencySlots) {
    const endpoint =
      slot.currentEndpoint ?? slot.defaultEndpoint ?? replicaEndpointsBySlotName.get(slot.name)

    if (endpoint === undefined) {
      continue
    }

    const endpointName = sanitizeEndpointName(slot.name)
    const existingEndpoint = endpoints[endpointName]
    if (existingEndpoint !== undefined && existingEndpoint !== endpoint) {
      throw new Error(`Endpoint name collision after sanitization for "${slot.name}"`)
    }

    endpoints[endpointName] = endpoint
  }

  return endpoints
}

export function sanitizeEndpointName(endpointName: string): string {
  return endpointName.replaceAll(".", "-")
}

type ReplicaCrdReadResult = {
  exists: boolean
  ready: boolean
  image: string | null
  endpoints: Record<string, string>
}

export async function readReplicaCrd(
  customObjectsApi: CustomObjectsApi,
  replicaName: string,
): Promise<ReplicaCrdReadResult> {
  try {
    const response = await customObjectsApi.getClusterCustomObject({
      group: REPLICA_API_GROUP,
      version: REPLICA_API_VERSION,
      plural: REPLICA_PLURAL,
      name: replicaName,
    })

    const body = toRecord(Reflect.get(response, "body") ?? response)
    const spec = toRecord(Reflect.get(body, "spec"))
    const status = toRecord(Reflect.get(body, "status"))

    const endpoints = parseEndpoints(Reflect.get(spec, "endpoints"))
    const image = parseImage(Reflect.get(spec, "image"))

    return {
      exists: true,
      ready: isCrdReady(status),
      image,
      endpoints,
    }
  } catch (error) {
    if (isNotFoundError(error)) {
      return {
        exists: false,
        ready: false,
        image: null,
        endpoints: {},
      }
    }

    throw error
  }
}

export function isNotFoundError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false
  }

  const code = Reflect.get(error, "code")
  if (code === 404 || code === "404") {
    return true
  }

  const statusCode = Reflect.get(error, "statusCode")
  if (statusCode === 404) {
    return true
  }

  const body = Reflect.get(error, "body")
  if (typeof body === "string") {
    try {
      const parsedBody = JSON.parse(body)
      return (
        typeof parsedBody === "object" &&
        parsedBody !== null &&
        Reflect.get(parsedBody, "code") === 404
      )
    } catch {
      return false
    }
  }

  if (typeof body === "object" && body !== null) {
    return Reflect.get(body, "code") === 404
  }

  return false
}

function parseImage(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }

  const image = value.trim()
  return image.length > 0 ? image : null
}

function parseEndpoints(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null) {
    return {}
  }

  const entries = Object.entries(value)
  const endpoints: Record<string, string> = {}
  for (const [key, endpointValue] of entries) {
    if (typeof endpointValue !== "string") {
      continue
    }

    endpoints[key] = endpointValue
  }

  return endpoints
}

function isCrdReady(status: Record<string, unknown>): boolean {
  const phase = Reflect.get(status, "phase")
  if (phase === "Ready") {
    return true
  }

  const conditions = Reflect.get(status, "conditions")
  if (!Array.isArray(conditions)) {
    return false
  }

  return conditions.some(condition => {
    if (typeof condition !== "object" || condition === null) {
      return false
    }

    return Reflect.get(condition, "type") === "Ready" && Reflect.get(condition, "status") === "True"
  })
}

function toRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null) {
    return value as Record<string, unknown>
  }

  return {}
}
