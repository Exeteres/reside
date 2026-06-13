import type { IssuerDefinition } from "./shared"
import { readFile } from "node:fs/promises"

const kubernetesServiceAccountTokenPath = "/var/run/secrets/kubernetes.io/serviceaccount/token"
let kubernetesServiceAccountTokenPromise: Promise<string> | null = null

export const kubernetesIssuerDefinitions: Record<string, IssuerDefinition> = {
  "https://kubernetes.default.svc.cluster.local": {
    realName: "replica",
    getRequestInit: getKubernetesRequestInit,
    extractSubjectName: extractKubernetesSubjectName,
  },
}

function extractKubernetesSubjectName(subject: string): string {
  const segments = subject.split(":")
  if (segments.length !== 4) {
    throw new Error(`Invalid replica subject: "${subject}"`)
  }

  const [realm, kind, namespace] = segments
  if (realm !== "system" || kind !== "serviceaccount") {
    throw new Error(`Invalid replica subject: "${subject}"`)
  }

  if (!namespace || !namespace.startsWith("replica-")) {
    throw new Error(
      `Invalid replica subject: namespace must start with "replica-", got "${namespace}"`,
    )
  }

  return namespace.slice("replica-".length)
}

async function getKubernetesRequestInit(): Promise<RequestInit> {
  kubernetesServiceAccountTokenPromise ??= readMountedServiceAccountToken()
  const token = await kubernetesServiceAccountTokenPromise

  return {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  }
}

async function readMountedServiceAccountToken(): Promise<string> {
  const token = (await readFile(kubernetesServiceAccountTokenPath, "utf8")).trim()
  if (token.length === 0) {
    throw new Error(
      `Mounted service account token is empty: "${kubernetesServiceAccountTokenPath}"`,
    )
  }

  return token
}
