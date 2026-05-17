import type { ReplicaEnvironmentVariable } from "./types"
import { getStatusCode, isRecord } from "@reside/utils"
import {
  getReplicaImage,
  getReplicaName,
  getReplicaNamespace,
  getReplicaServiceAccountName,
} from "../kubernetes"

export function isNotFoundError(error: unknown): boolean {
  return getStatusCode(error) === 404
}

export function isAlreadyExistsError(error: unknown): boolean {
  return getStatusCode(error) === 409
}

export function buildReplicaContainerEnv(
  componentName: string,
  extraEnv: ReplicaEnvironmentVariable[] = [],
): ReplicaEnvironmentVariable[] {
  const clusterDomain = process.env.RESIDE_CLUSTER_DOMAIN?.trim()
  if (!clusterDomain || clusterDomain.length === 0) {
    throw new Error('"RESIDE_CLUSTER_DOMAIN" environment variable is required')
  }

  return [
    {
      name: "NODE_EXTRA_CA_CERTS",
      value: "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt",
    },
    {
      name: "REPLICA_NAME",
      value: getReplicaName(),
    },
    {
      name: "REPLICA_COMPONENT_NAME",
      value: componentName,
    },
    {
      name: "REPLICA_NAMESPACE",
      value: getReplicaNamespace(),
    },
    {
      name: "REPLICA_SERVICE_ACCOUNT_NAME",
      value: getReplicaServiceAccountName(),
    },
    {
      name: "REPLICA_IMAGE",
      value: getReplicaImage(),
    },
    {
      name: "RESIDE_CLUSTER_DOMAIN",
      value: clusterDomain,
    },
    ...extraEnv,
  ]
}

export function extractResourceVersion(obj: unknown): string | undefined {
  if (!isRecord(obj)) {
    return undefined
  }

  const metadata = obj.metadata
  if (!isRecord(metadata)) {
    return undefined
  }

  const resourceVersion = metadata.resourceVersion
  if (typeof resourceVersion !== "string") {
    return undefined
  }

  return resourceVersion
}

export function extractAnnotations(obj: unknown): Record<string, string> | undefined {
  if (!isRecord(obj)) {
    return undefined
  }

  const metadata = obj.metadata
  if (!isRecord(metadata)) {
    return undefined
  }

  const annotations = metadata.annotations
  if (!isRecord(annotations)) {
    return undefined
  }

  const result: Record<string, string> = {}

  for (const [key, value] of Object.entries(annotations)) {
    if (typeof value === "string") {
      result[key] = value
    }
  }

  return result
}
