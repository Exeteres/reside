import type { CoreV1Api } from "@kubernetes/client-node"
import type { PostgresAdminConfig } from "./postgres/config"
import { pbkdf2Sync, randomBytes } from "node:crypto"
import { getStatusCode } from "@reside/utils"
import { Pool as PostgresPool } from "pg"
import { buildDatabaseConnectionString } from "./postgres/config"

export const MATHESAR_DATABASE_SECRET_NAME = "mathesar"
const MATHESAR_ADMIN_USERNAME = "admin"
const MATHESAR_ADMIN_PASSWORD_KEY = "MATHESAR_ADMIN_PASSWORD"
const MATHESAR_DATABASE_NAME = "mathesar_django"
const DJANGO_PBKDF2_SHA256_ITERATIONS = 600_000
const DJANGO_PBKDF2_SHA256_KEY_LENGTH = 32
const DJANGO_PASSWORD_SALT_ALPHABET =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

type MathesarLoginStatus = "ok" | "invalid-credentials"

type MathesarCompleteInstallationInput = {
  baseUrl: string
  username: string
  password: string
}

type MathesarConnectExistingDatabaseInput = {
  baseUrl: string
  username: string
  password: string
  database: MathesarDatabaseTarget
  adminConfig: PostgresAdminConfig
}

type MathesarDisconnectDatabaseInput = {
  baseUrl: string
  username: string
  password: string
  database: string
  adminConfig: PostgresAdminConfig
}

type MathesarConfiguredDatabase = {
  id: number
  name: string
  nickname?: string | null
}

export type MathesarDatabaseTarget = {
  id: number | string
  database: string
}

export type MathesarAdminCredentials = {
  username: string
  password: string
}

export function buildMathesarBaseUrl(namespace: string): string {
  return `http://mathesar.${namespace}.svc.cluster.local`
}

export function decodeSecretValue(value: string | undefined, context: string): string {
  if (!value) {
    throw new Error(context)
  }

  return Buffer.from(value, "base64").toString("utf-8")
}

export function encodeSecretValue(value: string): string {
  return Buffer.from(value, "utf-8").toString("base64")
}

export async function loadMathesarAdminCredentials(
  coreApi: CoreV1Api,
  namespace: string,
): Promise<MathesarAdminCredentials> {
  const secret = await coreApi.readNamespacedSecret({
    name: MATHESAR_DATABASE_SECRET_NAME,
    namespace,
  })

  const password = decodeSecretValue(
    secret.data?.[MATHESAR_ADMIN_PASSWORD_KEY],
    `Secret "${MATHESAR_DATABASE_SECRET_NAME}" is missing "${MATHESAR_ADMIN_PASSWORD_KEY}"`,
  )

  return {
    username: MATHESAR_ADMIN_USERNAME,
    password,
  }
}

/**
 * Completes Mathesar installation by creating an admin user if installation is not completed yet.
 */
export async function completeMathesarInstallation(
  input: MathesarCompleteInstallationInput,
): Promise<void> {
  const { baseUrl, username, password } = input
  const cookieJar = new Map<string, string>()

  const installGetResponse = await fetch(`${baseUrl}/complete_installation/`, {
    method: "GET",
    redirect: "manual",
  })
  appendResponseCookies(cookieJar, installGetResponse)

  // completed installations redirect to home instead of rendering installation form
  if (isRedirect(installGetResponse.status)) {
    return
  }

  ensureSuccessStatus(installGetResponse, "complete installation page")

  const csrfToken = cookieJar.get("csrftoken")
  if (!csrfToken) {
    throw new Error("Mathesar did not provide CSRF token for complete_installation")
  }

  const installPayload = new URLSearchParams()
  installPayload.set("csrfmiddlewaretoken", csrfToken)
  installPayload.set("username", username)
  installPayload.set("password1", password)
  installPayload.set("password2", password)
  installPayload.set("one_time_installation_confirmation", "on")
  installPayload.set("usage_stats", "on")

  const installPostResponse = await fetch(`${baseUrl}/complete_installation/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-CSRFToken": csrfToken,
      Cookie: buildCookieHeader(cookieJar),
    },
    body: installPayload.toString(),
    redirect: "manual",
  })
  appendResponseCookies(cookieJar, installPostResponse)

  if (isRedirect(installPostResponse.status)) {
    return
  }

  ensureSuccessStatus(installPostResponse, "complete installation submit")

  const body = await installPostResponse.text()
  if (body.includes("error") || body.includes("invalid") || body.includes("required")) {
    throw new Error("Mathesar installation form was submitted but admin user was not created")
  }
}

export async function connectMathesarDatabaseAsAdmin(
  input: MathesarConnectExistingDatabaseInput,
): Promise<void> {
  const { baseUrl, username, password, database, adminConfig } = input
  const cookieJar = new Map<string, string>()

  const loginStatus = await loginToMathesar(baseUrl, username, password, cookieJar)
  if (loginStatus === "invalid-credentials") {
    await updateMathesarUserPassword(adminConfig, username, password)

    cookieJar.clear()

    const retryLoginStatus = await loginToMathesar(baseUrl, username, password, cookieJar)
    if (retryLoginStatus === "invalid-credentials") {
      throw new Error("Mathesar login failed with provided admin credentials")
    }
  }

  const csrfToken = cookieJar.get("csrftoken")
  if (!csrfToken) {
    throw new Error("Mathesar did not provide CSRF token after login")
  }

  const payload = {
    jsonrpc: "2.0",
    id: `${database.id}`,
    method: "databases.setup.connect_existing",
    params: {
      host: adminConfig.host,
      port: adminConfig.port,
      database: database.database,
      role: adminConfig.username,
      password: adminConfig.password,
      nickname: database.database,
      sslmode: "prefer",
    },
  }

  const response = await fetch(`${baseUrl}/api/rpc/v0/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrfToken,
      Cookie: buildCookieHeader(cookieJar),
    },
    body: JSON.stringify(payload),
    redirect: "manual",
  })
  appendResponseCookies(cookieJar, response)

  ensureSuccessStatus(response, "databases.setup.connect_existing")

  const result = await response.json()
  if (!isRecord(result)) {
    throw new Error("Mathesar RPC returned invalid response for connect_existing")
  }

  if (isRecord(result.error)) {
    const code = typeof result.error.code === "number" ? result.error.code : "unknown"
    const message = typeof result.error.message === "string" ? result.error.message : "unknown"

    if (isDatabaseAlreadyConnectedError(message)) {
      return
    }

    throw new Error(`Mathesar RPC connect_existing failed (${code}): ${message}`)
  }
}

export async function disconnectMathesarDatabaseAsAdmin(
  input: MathesarDisconnectDatabaseInput,
): Promise<void> {
  const { baseUrl, username, password, database, adminConfig } = input
  const cookieJar = new Map<string, string>()

  await loginToMathesarAsAdmin({ baseUrl, username, password, adminConfig, cookieJar })

  const configuredDatabases = await requestMathesarRpc<MathesarConfiguredDatabase[]>({
    baseUrl,
    cookieJar,
    method: "databases.configured.list",
    params: {},
    context: "databases.configured.list",
  })
  const configuredDatabase = configuredDatabases.find(
    configured => configured.name === database || configured.nickname === database,
  )
  if (!configuredDatabase) {
    return
  }

  await requestMathesarRpc({
    baseUrl,
    cookieJar,
    method: "databases.configured.disconnect",
    params: {
      database_id: configuredDatabase.id,
      strict: false,
      role_name: adminConfig.username,
      password: adminConfig.password,
    },
    context: "databases.configured.disconnect",
  })
}

function isDatabaseAlreadyConnectedError(message: string): boolean {
  const normalized = message.toLowerCase()

  return (
    normalized.includes("already exists") ||
    normalized.includes("already connected") ||
    normalized.includes("already registered")
  )
}

async function loginToMathesar(
  baseUrl: string,
  username: string,
  password: string,
  cookieJar: Map<string, string>,
): Promise<MathesarLoginStatus> {
  const loginGetResponse = await fetch(`${baseUrl}/auth/login/`, {
    method: "GET",
    redirect: "manual",
  })
  appendResponseCookies(cookieJar, loginGetResponse)

  ensureSuccessStatus(loginGetResponse, "login page")

  const csrfToken = cookieJar.get("csrftoken")
  if (!csrfToken) {
    throw new Error("Mathesar did not provide CSRF token on login page")
  }

  const loginPayload = new URLSearchParams()
  loginPayload.set("csrfmiddlewaretoken", csrfToken)
  loginPayload.set("username", username)
  loginPayload.set("password", password)

  const loginPostResponse = await fetch(`${baseUrl}/auth/login/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-CSRFToken": csrfToken,
      Cookie: buildCookieHeader(cookieJar),
    },
    body: loginPayload.toString(),
    redirect: "manual",
  })
  appendResponseCookies(cookieJar, loginPostResponse)

  if (!isRedirect(loginPostResponse.status)) {
    ensureSuccessStatus(loginPostResponse, "login submit")

    const body = await loginPostResponse.text()
    if (body.includes("error") || body.includes("incorrect") || body.includes("invalid")) {
      return "invalid-credentials"
    }
  }

  if (!cookieJar.has("sessionid")) {
    return "invalid-credentials"
  }

  return "ok"
}

async function loginToMathesarAsAdmin({
  baseUrl,
  username,
  password,
  adminConfig,
  cookieJar,
}: {
  baseUrl: string
  username: string
  password: string
  adminConfig: PostgresAdminConfig
  cookieJar: Map<string, string>
}): Promise<void> {
  const loginStatus = await loginToMathesar(baseUrl, username, password, cookieJar)
  if (loginStatus !== "invalid-credentials") {
    return
  }

  await updateMathesarUserPassword(adminConfig, username, password)

  cookieJar.clear()

  const retryLoginStatus = await loginToMathesar(baseUrl, username, password, cookieJar)
  if (retryLoginStatus === "invalid-credentials") {
    throw new Error("Mathesar login failed with provided admin credentials")
  }
}

async function requestMathesarRpc<T = unknown>({
  baseUrl,
  cookieJar,
  method,
  params,
  context,
}: {
  baseUrl: string
  cookieJar: Map<string, string>
  method: string
  params: Record<string, unknown>
  context: string
}): Promise<T> {
  const csrfToken = cookieJar.get("csrftoken")
  if (!csrfToken) {
    throw new Error("Mathesar did not provide CSRF token after login")
  }

  const response = await fetch(`${baseUrl}/api/rpc/v0/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrfToken,
      Cookie: buildCookieHeader(cookieJar),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: context,
      method,
      params,
    }),
    redirect: "manual",
  })
  appendResponseCookies(cookieJar, response)

  ensureSuccessStatus(response, context)

  const result = await response.json()
  if (!isRecord(result)) {
    throw new Error(`Mathesar RPC returned invalid response for ${context}`)
  }

  if (isRecord(result.error)) {
    const code = typeof result.error.code === "number" ? result.error.code : "unknown"
    const message = typeof result.error.message === "string" ? result.error.message : "unknown"

    throw new Error(`Mathesar RPC ${context} failed (${code}): ${message}`)
  }

  return result.result as T
}

async function updateMathesarUserPassword(
  adminConfig: PostgresAdminConfig,
  username: string,
  password: string,
): Promise<void> {
  const databasePool = new PostgresPool({
    connectionString: buildDatabaseConnectionString(adminConfig, MATHESAR_DATABASE_NAME),
  })

  try {
    const hashedPassword = createDjangoPasswordHash(password)
    const updatedUser = await databasePool.query(
      "UPDATE mathesar_user SET password = $1, is_active = true, password_change_needed = false WHERE username = $2",
      [hashedPassword, username],
    )

    if ((updatedUser.rowCount ?? 0) === 0) {
      throw new Error(`Mathesar user "${username}" not found in database`)
    }
  } finally {
    await databasePool.end()
  }
}

function createDjangoPasswordHash(password: string): string {
  const salt = createDjangoPasswordSalt(12)
  const hash = pbkdf2Sync(
    password,
    salt,
    DJANGO_PBKDF2_SHA256_ITERATIONS,
    DJANGO_PBKDF2_SHA256_KEY_LENGTH,
    "sha256",
  ).toString("base64")

  return `pbkdf2_sha256$${DJANGO_PBKDF2_SHA256_ITERATIONS}$${salt}$${hash}`
}

function createDjangoPasswordSalt(length: number): string {
  const random = randomBytes(length)
  let salt = ""

  for (const value of random) {
    salt += DJANGO_PASSWORD_SALT_ALPHABET[value % DJANGO_PASSWORD_SALT_ALPHABET.length]
  }

  return salt
}

function appendResponseCookies(cookieJar: Map<string, string>, response: Response): void {
  for (const setCookieValue of response.headers.getSetCookie()) {
    const [cookiePair] = setCookieValue.split(";", 1)
    if (!cookiePair) {
      continue
    }

    const separatorIndex = cookiePair.indexOf("=")
    if (separatorIndex <= 0) {
      continue
    }

    const name = cookiePair.slice(0, separatorIndex).trim()
    const value = cookiePair.slice(separatorIndex + 1).trim()
    if (name.length === 0 || value.length === 0) {
      continue
    }

    cookieJar.set(name, value)
  }
}

function buildCookieHeader(cookieJar: Map<string, string>): string {
  return Array.from(cookieJar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ")
}

function ensureSuccessStatus(response: Response, context: string): void {
  if (response.ok) {
    return
  }

  throw new Error(`Mathesar request for ${context} failed with status ${response.status}`)
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function isNotFoundError(error: unknown): boolean {
  return getStatusCode(error) === 404
}
