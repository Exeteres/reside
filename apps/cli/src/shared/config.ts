import * as YAML from "yaml"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { z } from "zod"

export const ClusterConfig = z.object({
  /**
   * The local name of the cluster.
   */
  name: z.string(),

  /***
   * The namespace in the Kubernetes cluster where Reside is installed.
   */
  namespace: z.string(),

  /**
   * The public endpoint URL of the Reside cluster.
   * Will be used for both: connecting to Jazz sync server and making RPC requests to replicas.
   *
   * Must start with "http://" or "https://".
   */
  endpoint: z.url(),

  /**
   * The ID of the Alpha Replica.
   */
  alphaReplicaId: z.string(),

  /**
   * The name of the kubectl context for this cluster.
   */
  kubeContext: z.string(),
})

export const AccountRecipient = z.object({
  /**
   * The recipient's public key or identifier.
   */
  recipient: z.string(),

  /**
   * The label for the recipient.
   */
  label: z.string(),
})

export const AccountConfig = z.object({
  /**
   * The local name of the account.
   */
  name: z.string(),

  /**
   * The ID of the account.
   */
  accountId: z.string(),

  /**
   * The list of recipients which can decrypt account secret.
   */
  recipients: z.array(AccountRecipient),

  /**
   * The encrypted secret key of the account.
   */
  encryptedAgentSecret: z.string(),
})

export const ContextConfig = z.object({
  /**
   * The local name of the context.
   */
  name: z.string(),

  /**
   * The name of the cluster this context is associated with.
   */
  cluster: z.string(),

  /**
   * The name of the account this context is associated with.
   */
  account: z.string(),
})

/**
 * The local configuration of the Reside CLI.
 */
export const LocalConfig = z.object({
  /**
   * The name of the currently active context.
   */
  currentContext: z.string(),

  /**
   * The list of all configured contexts.
   */
  contexts: z.array(ContextConfig),

  /**
   * The list of all configured clusters.
   */
  clusters: z.array(ClusterConfig),

  /**
   * The list of all configured accounts.
   */
  accounts: z.array(AccountConfig),
})

export type ClusterConfig = z.infer<typeof ClusterConfig>
export type AccountConfig = z.infer<typeof AccountConfig>
export type ContextConfig = z.infer<typeof ContextConfig>
export type LocalConfig = z.infer<typeof LocalConfig>

function getConfigPath() {
  const homeDir = process.env.HOME || process.env.USERPROFILE
  if (!homeDir) {
    throw new Error("Cannot determine home directory for the current user")
  }

  return `${homeDir}/.config/reside/config.yaml`
}

let configCache: LocalConfig | null = null

async function _loadLocalConfig(): Promise<LocalConfig> {
  const configPath = getConfigPath()

  await mkdir(dirname(configPath), { recursive: true })

  try {
    const data = await readFile(configPath, "utf-8")
    const parsed = LocalConfig.safeParse(YAML.parse(data))
    if (!parsed.success) {
      throw new Error(`Invalid local config: ${parsed.error.message}`)
    }

    return parsed.data
  } catch (err: unknown) {
    if (typeof err === "object" && err && "code" in err && err.code === "ENOENT") {
      // file does not exist, return default config
      return {
        currentContext: "",
        contexts: [],
        clusters: [],
        accounts: [],
      }
    }

    throw err
  }
}

export async function loadLocalConfig(): Promise<LocalConfig> {
  if (configCache) {
    return configCache
  }

  const config = await _loadLocalConfig()
  configCache = config
  return config
}

export async function saveLocalConfig(config: LocalConfig): Promise<void> {
  const configPath = getConfigPath()

  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, YAML.stringify(config, null, 2), "utf-8")
  configCache = config
}

export async function getCurrentContextConfig(context?: string): Promise<ContextConfig> {
  const config = await loadLocalConfig()

  const contextName = context ?? config.currentContext
  if (!contextName) {
    throw new Error(`No context specified and no current context set in local configuration`)
  }

  const contextConfig = config.contexts.find(c => c.name === contextName)
  if (!contextConfig) {
    throw new Error(`Context "${contextName}" not found in local configuration`)
  }

  return contextConfig
}

export type ResolvedContextConfig = {
  context: ContextConfig
  cluster: ClusterConfig
  account: AccountConfig
}

export async function resolveCurrentContextConfig(
  context?: string,
): Promise<ResolvedContextConfig> {
  const config = await loadLocalConfig()
  const contextConfig = await getCurrentContextConfig(context)

  const clusterConfig = config.clusters.find(c => c.name === contextConfig.cluster)
  if (!clusterConfig) {
    throw new Error(
      `Cluster "${contextConfig.cluster}" for context "${contextConfig.name}" not found in local configuration`,
    )
  }

  const accountConfig = config.accounts.find(c => c.name === contextConfig.account)
  if (!accountConfig) {
    throw new Error(
      `Account "${contextConfig.account}" for context "${contextConfig.name}" not found in local configuration`,
    )
  }

  return {
    context: contextConfig,
    cluster: clusterConfig,
    account: accountConfig,
  }
}

export const contextArgs = {
  context: {
    description: "The name of the context to use.",
    type: "string" as const,
    required: false,
  },
}
