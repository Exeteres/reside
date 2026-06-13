import type { ConnectRouter } from "@connectrpc/connect"
import type { FastifyInstance } from "fastify"
import type { CommonServices } from "../services"
import { Buffer } from "node:buffer"
import { fastifyConnectPlugin } from "@connectrpc/connect-fastify"
import { createId } from "@paralleldrive/cuid2"
import { waitForOperationSuccess } from "@reside/api"
import { EncryptionService, type EncryptionServiceClient } from "@reside/api/common/encryption.v1"
import { WellKnownPermissions } from "@reside/registry"
import { decode, encode } from "cbor2"
import { z } from "zod"
import { createChannel, createClient } from "../api"
import { getReplicaName, getTokenForAudience } from "../kubernetes"
import { createEncryptionService } from "./service"

const ECID_PREFIX = "enc"
const ENCRYPTION_TRANSFER_PERMISSION_SET_PREFIX = "auto-request:encryption-transfer"
const ENCRYPTION_TRANSFER_REASON = "Для передачи зашифрованного содержимого между репликами Reside."
const VAULT_AUTH_BACKEND_PATH = "auth/reside/kubernetes/login"
const VAULT_DEFAULT_AUTH_ROLE = "replica"
const VAULT_TRANSIT_MOUNT_PATH = "reside/transit"
const VAULT_TOKEN_EXPIRATION_SKEW_MS = 60_000

export type ResideCrypto = {
  encrypt: (data: unknown) => Promise<string>
  getSecret: <TSchema extends z.ZodType>(schema: TSchema, name: string) => Promise<z.infer<TSchema>>
  decrypt: <TSchema extends z.ZodType>(
    schema: TSchema,
    ecid: string | string[],
    reason?: string,
  ) => Promise<z.infer<TSchema>>
}

export type EncryptionPrisma = {
  encryptedContent: {
    create: (args: {
      data: {
        ecid: string
        data: string
      }
      select: {
        ecid: true
      }
    }) => Promise<{ ecid: string }>
    findUnique: (args: {
      where: {
        ecid: string
      }
      select: {
        data: true
      }
    }) => Promise<{ data: string } | null>
    findMany: (args: {
      where: {
        ecid: {
          in: string[]
        }
      }
      select: {
        ecid: true
        data: true
      }
    }) => Promise<Array<{ ecid: string; data: string }>>
  }
}

export type EncryptionServices = Pick<CommonServices<"infra">, "vaultService"> & {
  prisma: EncryptionPrisma
} & Pick<
    CommonServices<"access">,
    "authzService" | "permissionRequestService" | "accessOperationService"
  >

export type EncryptionRuntime = {
  authzService: EncryptionServices["authzService"]
  transferToReplica: (ecids: string[], targetReplicaName: string) => Promise<string[]>
}

export type SetupEncryptionOptions = {
  services: EncryptionServices
  server?: FastifyInstance
}

type VaultCredentials = {
  endpoint: string
}

type CachedVaultToken = {
  token: string
  expiresAt: number
}

const vaultTokenCache = new Map<string, CachedVaultToken>()
const pendingVaultTokenRequests = new Map<string, Promise<CachedVaultToken>>()
let configuredCrypto: ResideCrypto | undefined

/**
 * Configures process-wide encryption helpers for the current replica.
 *
 * @param options The services and optional server used to configure encryption.
 */
export async function setupEncryption(
  options: EncryptionServices | SetupEncryptionOptions,
): Promise<void> {
  const setupOptions = normalizeSetupEncryptionOptions(options)
  const runtime = createEncryptionRuntime(setupOptions.services)

  configuredCrypto = createResideCrypto(setupOptions.services)

  if (!setupOptions.server) {
    return
  }

  await setupOptions.server.register(fastifyConnectPlugin, {
    routes(router: ConnectRouter) {
      router.service(EncryptionService, createEncryptionService({ runtime }))
    },
  })
}

export const crypto: ResideCrypto = {
  async encrypt(data) {
    if (!configuredCrypto) {
      throw new Error("Encryption is not configured")
    }

    return await configuredCrypto.encrypt(data)
  },
  async getSecret(schema, name) {
    if (!configuredCrypto) {
      throw new Error("Encryption is not configured")
    }

    return await configuredCrypto.getSecret(schema, name)
  },
  async decrypt(schema, ecid, reason) {
    if (!configuredCrypto) {
      throw new Error("Encryption is not configured")
    }

    return await configuredCrypto.decrypt(schema, ecid, reason)
  },
}

function createResideCrypto(services: EncryptionServices): ResideCrypto {
  return {
    async encrypt(data) {
      const replicaName = getReplicaName()
      const ecid = buildEcid(replicaName)
      const plaintext = Buffer.from(encode(data)).toString("base64")
      const credentials = await loadVaultCredentials(services)
      await ensureVaultTransitKey(credentials, replicaName)
      const ciphertext = await vaultTransitEncrypt(credentials, replicaName, plaintext)

      await services.prisma.encryptedContent.create({
        data: {
          ecid,
          data: ciphertext,
        },
        select: {
          ecid: true,
        },
      })

      return ecid
    },
    async getSecret(schema, name) {
      const normalizedName = name.trim()
      if (normalizedName.length === 0) {
        throw new Error("Vault secret name must not be empty")
      }

      const credentials = await loadVaultCredentials(services)
      while (true) {
        const secretData = await tryReadVaultSecret(credentials, normalizedName)
        if (secretData !== undefined) {
          return schema.parse(secretData)
        }

        await Bun.sleep(1000)
      }
    },
    async decrypt(schema, ecid, reason) {
      const ecids = Array.isArray(ecid) ? ecid : [ecid]
      if (ecids.length === 0) {
        return schema.parse([])
      }

      const replicaName = getReplicaName()
      const parsedEcids = ecids.map(currentEcid => ({
        ecid: currentEcid,
        parsed: parseEcid(currentEcid),
      }))
      const localEcids = parsedEcids
        .filter(({ parsed }) => parsed.replicaName === replicaName)
        .map(({ ecid: currentEcid }) => currentEcid)
      const remoteEcidsByReplica = new Map<string, string[]>()
      for (const parsedEcid of parsedEcids) {
        if (parsedEcid.parsed.replicaName === replicaName) {
          continue
        }

        const remoteEcids = remoteEcidsByReplica.get(parsedEcid.parsed.replicaName) ?? []
        remoteEcids.push(parsedEcid.ecid)
        remoteEcidsByReplica.set(parsedEcid.parsed.replicaName, remoteEcids)
      }

      const ciphertextByEcid = new Map<string, string>()
      if (localEcids.length > 0) {
        const localCiphertexts = await loadEncryptedContents(services.prisma, localEcids)
        for (const localCiphertext of localCiphertexts) {
          ciphertextByEcid.set(localCiphertext.ecid, localCiphertext.ciphertext)
        }
      }

      for (const [sourceReplicaName, replicaEcids] of remoteEcidsByReplica.entries()) {
        await ensureEncryptionTransferPermission(
          services,
          sourceReplicaName,
          reason ?? ENCRYPTION_TRANSFER_REASON,
        )
        const transfer = await getEncryptionService(sourceReplicaName).transfer({
          ecids: replicaEcids,
        })
        for (const [index, currentEcid] of replicaEcids.entries()) {
          const transferredCiphertext = transfer.ciphertexts[index]
          if (transferredCiphertext === undefined) {
            throw new Error(`Encryption transfer for "${currentEcid}" returned no ciphertext`)
          }

          ciphertextByEcid.set(currentEcid, transferredCiphertext)
        }
      }

      const credentials = await loadVaultCredentials(services)
      const decryptedValues: unknown[] = []
      for (const currentEcid of ecids) {
        const ciphertext = ciphertextByEcid.get(currentEcid)
        if (ciphertext === undefined) {
          throw new Error(`Encrypted content "${currentEcid}" is not found`)
        }

        const plaintext = await vaultTransitDecrypt(credentials, replicaName, ciphertext)
        decryptedValues.push(decode(Buffer.from(plaintext, "base64")))
      }

      if (Array.isArray(ecid)) {
        return schema.parse(decryptedValues)
      }

      return schema.parse(decryptedValues[0])
    },
  }
}

function createEncryptionRuntime(services: EncryptionServices): EncryptionRuntime {
  return {
    authzService: services.authzService,
    async transferToReplica(ecids, targetReplicaName) {
      const replicaName = getReplicaName()
      const credentials = await loadVaultCredentials(services)
      await ensureVaultTransitKey(credentials, targetReplicaName)

      const ciphertexts: string[] = []
      for (const ecid of ecids) {
        const parsedEcid = parseEcid(ecid)
        if (parsedEcid.replicaName !== replicaName) {
          throw new Error(`Encrypted content "${ecid}" does not belong to replica "${replicaName}"`)
        }

        const ciphertext = await loadEncryptedContent(services.prisma, ecid)
        const plaintext = await vaultTransitDecrypt(credentials, replicaName, ciphertext)
        ciphertexts.push(await vaultTransitEncrypt(credentials, targetReplicaName, plaintext))
      }

      return ciphertexts
    },
  }
}

async function loadEncryptedContent(prisma: EncryptionPrisma, ecid: string): Promise<string> {
  const encryptedContent = await prisma.encryptedContent.findUnique({
    where: {
      ecid,
    },
    select: {
      data: true,
    },
  })
  if (encryptedContent === null) {
    throw new Error(`Encrypted content "${ecid}" is not found`)
  }

  return encryptedContent.data
}

async function loadEncryptedContents(
  prisma: EncryptionPrisma,
  ecids: string[],
): Promise<Array<{ ecid: string; ciphertext: string }>> {
  const encryptedContents = await prisma.encryptedContent.findMany({
    where: {
      ecid: {
        in: ecids,
      },
    },
    select: {
      ecid: true,
      data: true,
    },
  })

  if (encryptedContents.length !== ecids.length) {
    const foundEcids = new Set(encryptedContents.map(({ ecid }) => ecid))
    for (const ecid of ecids) {
      if (!foundEcids.has(ecid)) {
        throw new Error(`Encrypted content "${ecid}" is not found`)
      }
    }
  }

  return encryptedContents.map(({ ecid, data }) => ({
    ecid,
    ciphertext: data,
  }))
}

function normalizeSetupEncryptionOptions(
  options: EncryptionServices | SetupEncryptionOptions,
): SetupEncryptionOptions {
  if ("services" in options) {
    return options
  }

  return {
    services: options,
  }
}

async function ensureEncryptionTransferPermission(
  services: EncryptionServices,
  sourceReplicaName: string,
  reason: string,
): Promise<void> {
  const response = await services.permissionRequestService.requestPermissions({
    reason,
    permissionSetName: `${ENCRYPTION_TRANSFER_PERMISSION_SET_PREFIX}:${sourceReplicaName}`,
    items: [
      {
        permissionName: WellKnownPermissions.ENCRYPTION_TRANSFER,
        scope: sourceReplicaName,
      },
    ],
  })

  if (response.operation) {
    await waitForOperationSuccess(response.operation, {
      operationService: services.accessOperationService,
    })
  }
}

function getEncryptionService(replicaName: string): EncryptionServiceClient {
  return createClient(EncryptionService, createChannel(getReplicaServiceEndpoint(replicaName)))
}

function getReplicaServiceEndpoint(replicaName: string): string {
  return `${replicaName}.replica-${replicaName}.svc.cluster.local:80`
}

function buildEcid(replicaName: string): string {
  return `${ECID_PREFIX}:${replicaName}:${createId()}`
}

function parseEcid(ecid: string): { replicaName: string; contentId: string } {
  const segments = ecid.split(":")
  const prefix = segments[0]
  const replicaName = segments[1]
  const contentId = segments[2]

  if (
    segments.length !== 3 ||
    prefix !== ECID_PREFIX ||
    replicaName === undefined ||
    replicaName.length === 0 ||
    contentId === undefined ||
    contentId.length === 0
  ) {
    throw new Error(`Invalid encrypted content id "${ecid}"`)
  }

  return {
    replicaName,
    contentId,
  }
}

async function loadVaultCredentials(services: EncryptionServices): Promise<VaultCredentials> {
  const response = await services.vaultService.getVaultCredentials({})
  if (!response.result) {
    throw new Error("Vault credentials response is missing result")
  }

  const endpoint = response.result.endpoint.trim().replace(/\/+$/, "")
  if (endpoint.length === 0) {
    throw new Error("Vault endpoint must not be empty")
  }

  return {
    endpoint,
  }
}

async function ensureVaultTransitKey(
  credentials: VaultCredentials,
  replicaName: string,
): Promise<void> {
  const keyName = buildVaultTransitKeyName(replicaName)
  await vaultRequest(credentials, `${VAULT_TRANSIT_MOUNT_PATH}/keys/${keyName}`, {})
}

async function vaultTransitEncrypt(
  credentials: VaultCredentials,
  replicaName: string,
  plaintext: string,
): Promise<string> {
  const keyName = buildVaultTransitKeyName(replicaName)
  const response = await vaultRequest(
    credentials,
    `${VAULT_TRANSIT_MOUNT_PATH}/encrypt/${keyName}`,
    { plaintext },
  )

  return vaultCiphertextResponseSchema.parse(response).data.ciphertext
}

async function vaultTransitDecrypt(
  credentials: VaultCredentials,
  replicaName: string,
  ciphertext: string,
): Promise<string> {
  const keyName = buildVaultTransitKeyName(replicaName)
  const response = await vaultRequest(
    credentials,
    `${VAULT_TRANSIT_MOUNT_PATH}/decrypt/${keyName}`,
    { ciphertext },
  )

  return vaultPlaintextResponseSchema.parse(response).data.plaintext
}

async function tryReadVaultSecret(
  credentials: VaultCredentials,
  name: string,
): Promise<unknown | undefined> {
  const token = await getVaultToken(credentials)
  const response = await fetch(`${credentials.endpoint}/v1/reside/secrets/data/${name}`, {
    method: "GET",
    headers: {
      "x-vault-token": token,
    },
  })

  if (response.status === 404 || response.status === 403) {
    return undefined
  }

  const parsed = await readVaultResponse(response, `reside/secrets/data/${name}`)
  const secret = vaultSecretResponseSchema.parse(parsed)

  return secret.data
}

async function vaultRequest(
  credentials: VaultCredentials,
  path: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const token = await getVaultToken(credentials)
  const response = await fetch(`${credentials.endpoint}/v1/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-vault-token": token,
    },
    body: JSON.stringify(body),
  })

  return await readVaultResponse(response, path)
}

async function getVaultToken(credentials: VaultCredentials): Promise<string> {
  const cacheKey = credentials.endpoint
  const cached = vaultTokenCache.get(cacheKey)
  const now = Date.now()

  if (cached && cached.expiresAt > now) {
    return cached.token
  }

  const pendingRequest = pendingVaultTokenRequests.get(cacheKey)
  if (pendingRequest) {
    const pendingToken = await pendingRequest
    return pendingToken.token
  }

  const tokenRequest = requestVaultToken(credentials)
  pendingVaultTokenRequests.set(cacheKey, tokenRequest)

  try {
    const requestedToken = await tokenRequest
    return requestedToken.token
  } finally {
    pendingVaultTokenRequests.delete(cacheKey)
  }
}

async function requestVaultToken(credentials: VaultCredentials): Promise<CachedVaultToken> {
  const jwt = await getTokenForAudience()
  const replicaName = getReplicaName()
  const replicaRole = buildVaultReplicaAuthRole(replicaName)
  let response = await fetch(`${credentials.endpoint}/v1/${VAULT_AUTH_BACKEND_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jwt,
      role: replicaRole,
    }),
  })

  if (response.status === 400 || response.status === 403) {
    response = await fetch(`${credentials.endpoint}/v1/${VAULT_AUTH_BACKEND_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jwt,
        role: VAULT_DEFAULT_AUTH_ROLE,
      }),
    })
  }

  const responseJson = await readVaultResponse(response, VAULT_AUTH_BACKEND_PATH)
  const loginResponse = vaultLoginResponseSchema.parse(responseJson)
  const expiresAt =
    Date.now() + loginResponse.auth.lease_duration * 1000 - VAULT_TOKEN_EXPIRATION_SKEW_MS
  const cachedToken = {
    token: loginResponse.auth.client_token,
    expiresAt,
  }

  vaultTokenCache.set(credentials.endpoint, cachedToken)

  return cachedToken
}

function buildVaultTransitKeyName(replicaName: string): string {
  return `replica-${replicaName}`
}

function buildVaultReplicaAuthRole(replicaName: string): string {
  return `replica-${replicaName}`
}

async function readVaultResponse(response: Response, path: string): Promise<unknown> {
  const text = await response.text()
  let parsed: unknown

  if (text.length === 0) {
    parsed = {}
  } else {
    parsed = JSON.parse(text)
  }

  if (!response.ok) {
    throw new Error(`Vault request "${path}" failed with status "${response.status}"`)
  }

  return parsed
}

const vaultLoginResponseSchema = z.object({
  auth: z.object({
    client_token: z.string().min(1),
    lease_duration: z.number().positive(),
  }),
})

const vaultCiphertextResponseSchema = z.object({
  data: z.object({
    ciphertext: z.string().min(1),
  }),
})

const vaultPlaintextResponseSchema = z.object({
  data: z.object({
    plaintext: z.string().min(1),
  }),
})

const vaultSecretResponseSchema = z.object({
  data: z
    .object({
      data: z.record(z.string(), z.unknown()).optional(),
    })
    .catchall(z.unknown())
    .transform(data => data.data ?? data),
})
