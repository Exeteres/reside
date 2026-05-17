import type { CoreV1Api, CustomObjectsApi, V1ConfigMap } from "@kubernetes/client-node"
import type { PrismaClient } from "../database"
import { applyObject, getReplicaName } from "@reside/common"

const GATEWAY_API_GROUP = "gateway.networking.k8s.io"
const GATEWAY_API_VERSION = "v1"
const GATEWAY_PLURAL = "gateways"
const INFRA_CONFIG_MAP_NAME = "infa"
const INFRA_GATEWAY_CLASS_NAME_KEY = "gatewayClassName"
const INFRA_GATEWAY_HTTP_PORT_KEY = "gatewayHttpPort"
const INFRA_GATEWAY_HTTPS_PORT_KEY = "gatewayHttpsPort"
const INFRA_CLUSTER_ISSUER_NAME_KEY = "clusterIssuerName"
const INFRA_NAMESPACE = "replica-infra"
const DEFAULT_TLS_SECRET_SUFFIX = "-tls"
const DEFAULT_HTTP_REDIRECT_ROUTE_SUFFIX = "-http-redirect"
const GATEWAY_PROGRAMMED_TIMEOUT_MS = 120_000
const GATEWAY_PROGRAMMED_POLL_INTERVAL_MS = 1_000

export type InfraGatewayConfig = {
  gatewayClassName: string
  gatewayHttpPort: number
  gatewayHttpsPort: number
  clusterIssuerName: string
}

export type EnsureGatewayRegistrationInput = {
  name: string
  ownerReplicaName: string
  title: string
  description?: string | null
}

export type EnsureGatewayRegistrationResult = {
  id: number
  name: string
  ownerReplicaName: string
  title: string
  description: string | null
  changed: boolean
}

export class InvalidGatewayNameError extends Error {
  constructor() {
    super("Gateway name must be a valid DNS label in lowercase")
  }
}

export class MissingGatewayTitleError extends Error {
  constructor() {
    super("Gateway title is required")
  }
}

export class GatewayOwnershipConflictError extends Error {
  readonly gatewayName: string
  readonly ownerReplicaName: string

  constructor(gatewayName: string, ownerReplicaName: string) {
    super(`Gateway "${gatewayName}" is already owned by replica "${ownerReplicaName}"`)
    this.gatewayName = gatewayName
    this.ownerReplicaName = ownerReplicaName
  }
}

export async function ensureGatewayRegistration(
  prisma: PrismaClient,
  input: EnsureGatewayRegistrationInput,
): Promise<EnsureGatewayRegistrationResult> {
  const normalized = normalizeGatewayRegistrationInput(input)

  const existingGateway = await prisma.gateway.findUnique({
    where: {
      name: normalized.name,
    },
    select: {
      id: true,
      ownerReplicaName: true,
      title: true,
      description: true,
    },
  })

  if (existingGateway !== null) {
    if (existingGateway.ownerReplicaName !== normalized.ownerReplicaName) {
      throw new GatewayOwnershipConflictError(normalized.name, existingGateway.ownerReplicaName)
    }

    if (
      existingGateway.title === normalized.title &&
      existingGateway.description === normalized.description
    ) {
      return {
        id: existingGateway.id,
        name: normalized.name,
        ownerReplicaName: normalized.ownerReplicaName,
        title: normalized.title,
        description: normalized.description,
        changed: false,
      }
    }
  }

  const gateway = await prisma.gateway.upsert({
    where: {
      name: normalized.name,
    },
    create: {
      name: normalized.name,
      ownerReplicaName: normalized.ownerReplicaName,
      title: normalized.title,
      description: normalized.description,
    },
    update: {
      ownerReplicaName: normalized.ownerReplicaName,
      title: normalized.title,
      description: normalized.description,
    },
    select: {
      id: true,
      name: true,
      ownerReplicaName: true,
      title: true,
      description: true,
    },
  })

  return {
    id: gateway.id,
    name: gateway.name,
    ownerReplicaName: gateway.ownerReplicaName,
    title: gateway.title,
    description: gateway.description,
    changed: true,
  }
}

export async function upsertGatewayResources(
  customObjectsApi: CustomObjectsApi,
  infraGatewayConfig: InfraGatewayConfig,
  gateway: {
    name: string
    ownerReplicaName: string
    title: string
    description: string | null
  },
): Promise<void> {
  const ownerNamespace = `replica-${gateway.ownerReplicaName}`
  const clusterDomain = process.env.RESIDE_CLUSTER_DOMAIN?.trim()
  const hostname =
    clusterDomain && clusterDomain.length > 0 ? `${gateway.name}.${clusterDomain}` : gateway.name
  const gatewayClassName = infraGatewayConfig.gatewayClassName
  const gatewayHttpPort = infraGatewayConfig.gatewayHttpPort
  const gatewayHttpsPort = infraGatewayConfig.gatewayHttpsPort
  const clusterIssuerName = infraGatewayConfig.clusterIssuerName

  const tlsSecretName = `${gateway.name}${DEFAULT_TLS_SECRET_SUFFIX}`
  const httpRedirectRouteName = `${gateway.name}${DEFAULT_HTTP_REDIRECT_ROUTE_SUFFIX}`

  await applyObject({
    apiVersion: `${GATEWAY_API_GROUP}/${GATEWAY_API_VERSION}`,
    kind: "Gateway",
    metadata: {
      name: gateway.name,
      namespace: INFRA_NAMESPACE,
      annotations: {
        "reside.io/managed-by": "infra",
        "reside.io/title": gateway.title,
        "reside.io/description": gateway.description ?? "",
        "reside.io/owner-replica": gateway.ownerReplicaName,
        "reside.io/infra-replica": getReplicaName(),
        "cert-manager.io/cluster-issuer": clusterIssuerName,
      },
    },
    spec: {
      gatewayClassName,
      listeners: [
        {
          name: "http",
          protocol: "HTTP",
          port: gatewayHttpPort,
          hostname,
          allowedRoutes: {
            namespaces: {
              from: "Same",
            },
          },
        },
        {
          name: "https",
          protocol: "HTTPS",
          port: gatewayHttpsPort,
          hostname,
          tls: {
            mode: "Terminate",
            certificateRefs: [
              {
                kind: "Secret",
                name: tlsSecretName,
              },
            ],
          },
          allowedRoutes: {
            namespaces: {
              from: "Selector",
              selector: {
                matchLabels: {
                  "kubernetes.io/metadata.name": ownerNamespace,
                },
              },
            },
          },
        },
      ],
    },
  })

  await waitForGatewayProgrammed(customObjectsApi, INFRA_NAMESPACE, gateway.name)

  await applyObject({
    apiVersion: `${GATEWAY_API_GROUP}/${GATEWAY_API_VERSION}`,
    kind: "HTTPRoute",
    metadata: {
      name: httpRedirectRouteName,
      namespace: INFRA_NAMESPACE,
      annotations: {
        "reside.io/managed-by": "infra",
        "reside.io/gateway": gateway.name,
        "reside.io/infra-replica": getReplicaName(),
      },
    },
    spec: {
      hostnames: [hostname],
      parentRefs: [
        {
          name: gateway.name,
          sectionName: "http",
        },
      ],
      rules: [
        {
          matches: [
            {
              path: {
                type: "PathPrefix",
                value: "/",
              },
            },
          ],
          filters: [
            {
              type: "RequestRedirect",
              requestRedirect: {
                scheme: "https",
                port: gatewayHttpsPort,
                statusCode: 301,
              },
            },
          ],
        },
      ],
    },
  })
}

async function waitForGatewayProgrammed(
  customObjectsApi: CustomObjectsApi,
  namespace: string,
  gatewayName: string,
): Promise<void> {
  const expectedGeneration = await readGatewayGeneration(customObjectsApi, namespace, gatewayName)
  const deadline = Date.now() + GATEWAY_PROGRAMMED_TIMEOUT_MS

  while (Date.now() < deadline) {
    const gateway = await readGatewayObject(customObjectsApi, namespace, gatewayName)
    if (isGatewayProgrammed(gateway, expectedGeneration)) {
      return
    }

    await sleep(GATEWAY_PROGRAMMED_POLL_INTERVAL_MS)
  }

  throw new Error(
    `Gateway "${gatewayName}" did not become Programmed=True within ${GATEWAY_PROGRAMMED_TIMEOUT_MS}ms`,
  )
}

async function readGatewayGeneration(
  customObjectsApi: CustomObjectsApi,
  namespace: string,
  gatewayName: string,
): Promise<number | undefined> {
  const gateway = await readGatewayObject(customObjectsApi, namespace, gatewayName)
  const generation = toNumber(gateway.metadata?.generation)
  return generation
}

async function readGatewayObject(
  customObjectsApi: CustomObjectsApi,
  namespace: string,
  gatewayName: string,
): Promise<GatewayObject> {
  const gateway = await customObjectsApi.getNamespacedCustomObject({
    group: GATEWAY_API_GROUP,
    version: GATEWAY_API_VERSION,
    namespace,
    plural: GATEWAY_PLURAL,
    name: gatewayName,
  })

  return toGatewayObject(gateway)
}

function isGatewayProgrammed(
  gateway: GatewayObject,
  expectedGeneration: number | undefined,
): boolean {
  const gatewayConditions = gateway.status?.conditions ?? []
  for (const condition of gatewayConditions) {
    if (isProgrammedConditionTrue(condition, expectedGeneration)) {
      return true
    }
  }

  const listeners = gateway.status?.listeners ?? []
  for (const listener of listeners) {
    const listenerConditions = listener.conditions ?? []
    for (const condition of listenerConditions) {
      if (isProgrammedConditionTrue(condition, expectedGeneration)) {
        return true
      }
    }
  }

  return false
}

function isProgrammedConditionTrue(
  condition: GatewayCondition,
  expectedGeneration: number | undefined,
): boolean {
  if (condition.type.toUpperCase() !== "PROGRAMMED") {
    return false
  }

  if (condition.status.toUpperCase() !== "TRUE") {
    return false
  }

  if (expectedGeneration === undefined) {
    return true
  }

  const observedGeneration = toNumber(condition.observedGeneration)
  if (observedGeneration === undefined) {
    return true
  }

  return observedGeneration >= expectedGeneration
}

function toGatewayObject(value: unknown): GatewayObject {
  if (!isRecord(value)) {
    throw new Error("Gateway API returned invalid object")
  }

  const metadata = isRecord(value.metadata) ? value.metadata : undefined
  const statusObject = isRecord(value.status) ? value.status : undefined
  const statusConditions = toGatewayConditions(statusObject?.conditions)
  const statusListeners = toGatewayListeners(statusObject?.listeners)

  return {
    metadata: {
      generation: metadata?.generation,
    },
    status: {
      conditions: statusConditions,
      listeners: statusListeners,
    },
  }
}

function toGatewayListeners(value: unknown): GatewayListenerStatus[] {
  if (!Array.isArray(value)) {
    return []
  }

  const listeners: GatewayListenerStatus[] = []
  for (const item of value) {
    if (!isRecord(item)) {
      continue
    }

    listeners.push({
      conditions: toGatewayConditions(item.conditions),
    })
  }

  return listeners
}

function toGatewayConditions(value: unknown): GatewayCondition[] {
  if (!Array.isArray(value)) {
    return []
  }

  const conditions: GatewayCondition[] = []
  for (const item of value) {
    if (!isRecord(item)) {
      continue
    }

    const type = toText(item.type)
    const status = toText(item.status)
    if (type === undefined || status === undefined) {
      continue
    }

    conditions.push({
      type,
      status,
      observedGeneration: item.observedGeneration,
    })
  }

  return conditions
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined
  }

  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  return undefined
}

function toText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value
  }

  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

async function sleep(durationMs: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, durationMs))
}

type GatewayObject = {
  metadata?: {
    generation?: unknown
  }
  status?: GatewayStatus
}

type GatewayStatus = {
  conditions: GatewayCondition[]
  listeners: GatewayListenerStatus[]
}

type GatewayListenerStatus = {
  conditions: GatewayCondition[]
}

type GatewayCondition = {
  type: string
  status: string
  observedGeneration?: unknown
}

export async function loadInfraGatewayConfig(
  coreApi: CoreV1Api,
  namespace = INFRA_NAMESPACE,
): Promise<InfraGatewayConfig> {
  const configMap = await coreApi.readNamespacedConfigMap({
    name: INFRA_CONFIG_MAP_NAME,
    namespace,
  })

  const gatewayClassName = getRequiredConfigValue(configMap, INFRA_GATEWAY_CLASS_NAME_KEY)
  const gatewayHttpPort = getRequiredPortValue(configMap, INFRA_GATEWAY_HTTP_PORT_KEY)
  const gatewayHttpsPort = getRequiredPortValue(configMap, INFRA_GATEWAY_HTTPS_PORT_KEY)
  const clusterIssuerName = getRequiredConfigValue(configMap, INFRA_CLUSTER_ISSUER_NAME_KEY)

  return {
    gatewayClassName,
    gatewayHttpPort,
    gatewayHttpsPort,
    clusterIssuerName,
  }
}

function normalizeGatewayRegistrationInput(input: EnsureGatewayRegistrationInput) {
  const name = input.name.trim()
  const title = input.title.trim()
  const ownerReplicaName = input.ownerReplicaName.trim()
  const description = toNullableText(input.description)

  if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(name)) {
    throw new InvalidGatewayNameError()
  }

  if (title.length === 0) {
    throw new MissingGatewayTitleError()
  }

  if (ownerReplicaName.length === 0) {
    throw new Error("Gateway owner replica name is required")
  }

  return {
    name,
    title,
    ownerReplicaName,
    description,
  }
}

function toNullableText(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? ""
  return normalized.length > 0 ? normalized : null
}

function getRequiredConfigValue(configMap: V1ConfigMap, key: string): string {
  const value = configMap.data?.[key]?.trim()
  if (!value) {
    const configMapName = configMap.metadata?.name ?? INFRA_CONFIG_MAP_NAME
    throw new Error(`ConfigMap "${configMapName}" must contain "${key}"`)
  }

  return value
}

function getRequiredPortValue(configMap: V1ConfigMap, key: string): number {
  const raw = getRequiredConfigValue(configMap, key)
  const parsed = Number(raw)

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    const configMapName = configMap.metadata?.name ?? INFRA_CONFIG_MAP_NAME
    throw new Error(
      `ConfigMap "${configMapName}" must contain a valid TCP port in "${key}", got "${raw}"`,
    )
  }

  return parsed
}
