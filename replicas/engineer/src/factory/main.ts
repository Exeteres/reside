import type { StorageBucketCredentials } from "@reside/api/infra/provision.v1"
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { waitForResult } from "@reside/api"
import {
  configureGracefulShutdown,
  logger,
  setupEncryption,
  startMcpToolServer,
} from "@reside/common"
import { crypto } from "@reside/common/encryption"
import { z } from "zod"
import {
  ENGINEER_FACTORY_PORT,
  ENGINEER_FACTORY_STORAGE_PREFIX,
  FACTORY_REPOSITORY_DIR,
  FACTORY_ROOT_DIR,
} from "../definitions"
import { startGitHubService } from "../replica/business"
import { createServices } from "../shared"
import {
  createCommitChangesTool,
  createDeliverChangesTool,
  createDeployReplicaTool,
  createDevDatabaseTool,
} from "./tools"

const FACTORY_RCLONE_CONFIG_DIR = ".config/rclone"
const FACTORY_RCLONE_CONFIG_FILE = "rclone.conf"
const FACTORY_RCLONE_REMOTE = "factory-storage"
const FACTORY_SYNC_INTERVAL_MS = 60_000
const FACTORY_REPOSITORY_PULL_INTERVAL_MS = 5 * 60_000
const FACTORY_SHUTDOWN_TIMEOUT_MS = 120_000
const FACTORY_MCP_TOKEN_ENV_VAR = "ENGINEER_FACTORY_MCP_TOKEN"
const RESIDE_LLM_ENDPOINT_ENV_VAR = "RESIDE_LLM_ENDPOINT"
const RESIDE_LLM_API_KEY_ENV_VAR = "RESIDE_LLM_API_KEY"
const GITHUB_MCP_URL = "https://api.githubcopilot.com/mcp/"
const SIGNOZ_MCP_BINARY_PATH = "/usr/local/bin/signoz-mcp-server"
const SIGNOZ_URL = "http://signoz.replica-infra.svc.cluster.local:8080"
const OPENCODE_REPOSITORY_CONFIG_PATH = ".opencode/opencode.json"
const OPENCODE_CONFIG_DIR = ".config/opencode"
const OPENCODE_CONFIG_FILE = "opencode.json"

const OPENCODE_BACKUP_DIRS = [
  {
    localPath: ".config/opencode",
    remotePath: "opencode/config",
  },
  {
    localPath: ".local/share/opencode",
    remotePath: "opencode/share",
  },
  {
    localPath: ".cache/opencode",
    remotePath: "opencode/cache",
  },
]

type OpenCodeConfig = {
  mcp?: Record<string, unknown>
  [key: string]: unknown
}

const llmSecretSchema = z.object({
  endpoint: z.string().trim().min(1),
  "api-key": z.string().trim().min(1),
  "light-model": z.string().trim().min(1),
  "smart-model": z.string().trim().min(1),
})

const signozSecretSchema = z.object({
  "api-key": z.string().trim().min(1),
})

async function main(): Promise<void> {
  configureGracefulShutdown({
    forcedExitDelayMs: null,
    exitOnComplete: false,
  })

  const services = await createServices()
  await setupEncryption(services)
  const github = await startGitHubService()
  const repository = await github.getRepositoryTarget()
  await github.getOctokit()
  const credentialsResponse = await services.provisionService.getStorageBucketCredentials({})

  if (!credentialsResponse.credentials || credentialsResponse.credentials.case === undefined) {
    throw new Error("Infra did not return factory storage credentials")
  }

  const storageCredentials = await waitForResult<StorageBucketCredentials>(
    credentialsResponse.credentials,
    {
      operationService: services.infraOperationService,
    },
  )
  const homeDir = homedir()
  const factoryRoot = join(homeDir, FACTORY_ROOT_DIR)
  const repositoryPath = join(factoryRoot, FACTORY_REPOSITORY_DIR)
  const rcloneConfigPath = join(homeDir, FACTORY_RCLONE_CONFIG_DIR, FACTORY_RCLONE_CONFIG_FILE)
  const repositoryRefresh = createRepositoryRefresh({
    github,
    repositoryPath,
    cloneUrl: repository.cloneUrl,
  })

  logger.info('engineer factory initializing repository_path="%s"', repositoryPath)
  await writeRcloneConfig(rcloneConfigPath, storageCredentials)
  await restoreFactoryState({ homeDir, factoryRoot, rcloneConfigPath, storageCredentials })
  await logRepositoryRestoreDebug(repositoryPath)
  await repositoryRefresh.refresh()
  await syncFactoryState({ homeDir, factoryRoot, rcloneConfigPath, storageCredentials })
  await configureOpenCodeProviderEnvironment()

  const sharedMcpServer = await startSharedFactoryMcpServer({
    github,
    services,
    owner: repository.owner,
    repo: repository.name,
    refreshRepository: repositoryRefresh.refresh,
  })
  await configureFactoryOpenCode(homeDir, repositoryPath, sharedMcpServer, github)
  const opencode = startOpenCodeServer(repositoryPath)
  const syncLoop = startSyncLoop({ homeDir, factoryRoot, rcloneConfigPath, storageCredentials })
  const repositoryPullLoop = startRepositoryPullLoop(repositoryRefresh.refresh)

  const stop = async () => {
    logger.info("engineer factory shutdown started")
    syncLoop.stop()
    repositoryPullLoop.stop()
    opencode.kill("SIGTERM")
    await Promise.race([opencode.exited, Bun.sleep(FACTORY_SHUTDOWN_TIMEOUT_MS)])
    await sharedMcpServer.stop()
    await syncFactoryState({ homeDir, factoryRoot, rcloneConfigPath, storageCredentials })
    await github.stop()
    logger.info("engineer factory shutdown completed")
  }

  process.once("SIGTERM", () => {
    void stop().finally(() => process.exit(0))
  })
  process.once("SIGINT", () => {
    void stop().finally(() => process.exit(0))
  })

  logger.info('engineer factory started repository_path="%s"', repositoryPath)
  await opencode.exited
  syncLoop.stop()
  repositoryPullLoop.stop()
}

await main()

async function startSharedFactoryMcpServer({
  github,
  services,
  owner,
  repo,
  refreshRepository,
}: {
  github: Awaited<ReturnType<typeof startGitHubService>>
  services: Awaited<ReturnType<typeof createServices>>
  owner: string
  repo: string
  refreshRepository: () => Promise<void>
}) {
  logger.info('engineer factory mcp server starting owner="%s" repo="%s"', owner, repo)

  return await startMcpToolServer({
    name: "reside-engineer",
    invocationId: "factory",
    token: process.env[FACTORY_MCP_TOKEN_ENV_VAR],
    tools: [
      createCommitChangesTool({ refreshRepository }),
      createDeliverChangesTool({
        github,
        owner,
        repo,
        refreshRepository,
      }),
      createDeployReplicaTool({
        github,
        permissionRequestService: services.permissionRequestService,
        accessOperationService: services.accessOperationService,
        loadService: services.alphaLoadService,
        alphaOperationService: services.alphaOperationService,
        owner,
        repo,
      }),
      createDevDatabaseTool({
        provisionService: services.provisionService,
        infraOperationService: services.infraOperationService,
      }),
    ],
    instructions:
      "Use these tools for Engineer Factory repository workspaces. Always pass the absolute current repository directory as workingDir when changing, delivering, or deploying code.",
  })
}

async function configureFactoryOpenCode(
  homeDir: string,
  repositoryPath: string,
  mcpServer: { name: string; url: string; token: string },
  github: Awaited<ReturnType<typeof startGitHubService>>,
): Promise<void> {
  const configPath = join(homeDir, OPENCODE_CONFIG_DIR, OPENCODE_CONFIG_FILE)
  const repositoryConfigPath = join(repositoryPath, OPENCODE_REPOSITORY_CONFIG_PATH)
  const config = await readOpenCodeConfig(repositoryConfigPath, true)

  await mkdir(dirname(configPath), { recursive: true })
  const openCodeConfig = await createFactoryOpenCodeConfig(config, mcpServer, github)

  await writeFile(configPath, `${JSON.stringify(openCodeConfig, null, 2)}\n`)
  logger.info(
    'engineer factory opencode configured config_path="%s" repository_config_path="%s" mcp_name="%s"',
    configPath,
    repositoryConfigPath,
    mcpServer.name,
  )
}

async function readOpenCodeConfig(configPath: string, required: boolean): Promise<OpenCodeConfig> {
  try {
    const rawConfig = await readFile(configPath, "utf8")

    return JSON.parse(stripJsonCommentsAndTrailingCommas(rawConfig)) as OpenCodeConfig
  } catch (error) {
    if (!required && error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {}
    }

    throw new Error("Failed to read OpenCode factory config", { cause: error })
  }
}

function stripJsonCommentsAndTrailingCommas(value: string): string {
  let output = ""
  let isInString = false
  let isEscaped = false
  let isInLineComment = false
  let isInBlockComment = false

  for (let index = 0; index < value.length; index++) {
    const char = value[index]
    const next = value[index + 1]

    if (isInLineComment) {
      if (char === "\n") {
        isInLineComment = false
        output += char
      }
      continue
    }

    if (isInBlockComment) {
      if (char === "*" && next === "/") {
        isInBlockComment = false
        index++
      }
      continue
    }

    if (isInString) {
      output += char

      if (isEscaped) {
        isEscaped = false
      } else if (char === "\\") {
        isEscaped = true
      } else if (char === '"') {
        isInString = false
      }
      continue
    }

    if (char === '"') {
      isInString = true
      output += char
      continue
    }

    if (char === "/" && next === "/") {
      isInLineComment = true
      index++
      continue
    }

    if (char === "/" && next === "*") {
      isInBlockComment = true
      index++
      continue
    }

    output += char
  }

  return output.replaceAll(/,\s*([}\]])/g, "$1")
}

async function createFactoryOpenCodeConfig(
  config: OpenCodeConfig,
  mcpServer: { name: string; url: string; token: string },
  github: Awaited<ReturnType<typeof startGitHubService>>,
): Promise<OpenCodeConfig> {
  const githubToken = await createGitHubInstallationToken(github)
  const signozSecret = await crypto.getSecret(signozSecretSchema, "signoz")

  return {
    ...config,
    enabled_providers: ["reside"],
    mcp: {
      ...config.mcp,
      [mcpServer.name]: {
        type: "remote",
        url: mcpServer.url,
        enabled: true,
        headers: {
          authorization: `Bearer ${mcpServer.token}`,
        },
        oauth: false,
        timeout: 600_000,
      },
      github: {
        type: "remote",
        url: GITHUB_MCP_URL,
        enabled: true,
        headers: {
          "X-MCP-Toolsets": "default,actions",
          authorization: `Bearer ${githubToken}`,
        },
        oauth: false,
        timeout: 600_000,
      },
      signoz: {
        type: "local",
        command: [SIGNOZ_MCP_BINARY_PATH],
        enabled: true,
        environment: {
          SIGNOZ_URL,
          SIGNOZ_API_KEY: signozSecret["api-key"],
          LOG_LEVEL: "info",
        },
        timeout: 600_000,
      },
    },
  }
}

async function configureOpenCodeProviderEnvironment(): Promise<void> {
  const llmSecret = await crypto.getSecret(llmSecretSchema, "llm")
  process.env[RESIDE_LLM_ENDPOINT_ENV_VAR] = llmSecret.endpoint
  process.env[RESIDE_LLM_API_KEY_ENV_VAR] = llmSecret["api-key"]
}

async function ensureRepository({
  github,
  repositoryPath,
  cloneUrl,
}: {
  github: Awaited<ReturnType<typeof startGitHubService>>
  repositoryPath: string
  cloneUrl: string
}): Promise<void> {
  const authenticatedCloneUrl = await createAuthenticatedCloneUrl(github, cloneUrl)

  if (!(await pathExists(join(repositoryPath, ".git")))) {
    logger.info('engineer factory repository clone started repository_path="%s"', repositoryPath)
    await runCommand(["git", "clone", authenticatedCloneUrl, repositoryPath])
  } else {
    logger.info('engineer factory repository clone skipped repository_path="%s"', repositoryPath)
  }

  await runCommand([
    "git",
    "-C",
    repositoryPath,
    "remote",
    "set-url",
    "origin",
    authenticatedCloneUrl,
  ])
  await runCommand(["git", "-C", repositoryPath, "fetch", "origin", "main"])
  await discardRepositoryChanges(repositoryPath)
  await runCommand(["git", "-C", repositoryPath, "config", "user.name", "reside-agent[bot]"])
  await runCommand([
    "git",
    "-C",
    repositoryPath,
    "config",
    "user.email",
    "248754993+reside-agent[bot]@users.noreply.github.com",
  ])
}

async function discardRepositoryChanges(repositoryPath: string): Promise<void> {
  logger.info(
    'engineer factory repository local changes discard started repository_path="%s"',
    repositoryPath,
  )
  await runCommand(["git", "-C", repositoryPath, "checkout", "-B", "main", "origin/main"])
  await runCommand(["git", "-C", repositoryPath, "reset", "--hard", "origin/main"])
  await runCommand(["git", "-C", repositoryPath, "clean", "-fd"])
  logger.info(
    'engineer factory repository local changes discard completed repository_path="%s"',
    repositoryPath,
  )
}

function createRepositoryRefresh({
  github,
  repositoryPath,
  cloneUrl,
}: {
  github: Awaited<ReturnType<typeof startGitHubService>>
  repositoryPath: string
  cloneUrl: string
}): { refresh: () => Promise<void> } {
  let refreshPromise: Promise<void> | undefined

  return {
    refresh: async () => {
      while (refreshPromise !== undefined) {
        await refreshPromise
      }

      refreshPromise = ensureRepository({ github, repositoryPath, cloneUrl }).finally(() => {
        refreshPromise = undefined
      })

      await refreshPromise
    },
  }
}

function startOpenCodeServer(
  repositoryPath: string,
): Bun.Subprocess<"ignore", "inherit", "inherit"> {
  logger.info(
    'engineer factory opencode server starting port="%s" repository_path="%s"',
    process.env.ENGINEER_FACTORY_PORT ?? String(ENGINEER_FACTORY_PORT),
    repositoryPath,
  )

  return Bun.spawn(
    [
      "opencode",
      "web",
      "--hostname",
      "0.0.0.0",
      "--port",
      process.env.ENGINEER_FACTORY_PORT ?? String(ENGINEER_FACTORY_PORT),
    ],
    {
      cwd: repositoryPath,
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
      env: process.env,
    },
  )
}

function startSyncLoop(args: SyncFactoryStateArgs): { stop: () => void } {
  const timer = setInterval(() => {
    void syncFactoryState(args).catch(error => {
      logger.warn({ error: normalizeError(error) }, "engineer factory sync failed")
    })
  }, FACTORY_SYNC_INTERVAL_MS)

  return {
    stop: () => clearInterval(timer),
  }
}

function startRepositoryPullLoop(refreshRepository: () => Promise<void>): { stop: () => void } {
  const timer = setInterval(() => {
    void refreshRepository().catch(error => {
      logger.warn({ error: normalizeError(error) }, "engineer factory repository refresh failed")
    })
  }, FACTORY_REPOSITORY_PULL_INTERVAL_MS)

  return {
    stop: () => clearInterval(timer),
  }
}

type SyncFactoryStateArgs = {
  homeDir: string
  factoryRoot: string
  rcloneConfigPath: string
  storageCredentials: StorageBucketCredentials
}

async function restoreFactoryState(args: SyncFactoryStateArgs): Promise<void> {
  for (const dir of getBackupDirs(args.homeDir, args.factoryRoot)) {
    logger.info(
      'engineer factory restore started local_path="%s" remote_path="%s"',
      dir.localPath,
      dir.remotePath,
    )
    await mkdir(dir.localPath, { recursive: true })
    await runRclone(
      [
        "sync",
        `${FACTORY_RCLONE_REMOTE}:${args.storageCredentials.bucket}/${dir.remotePath}`,
        dir.localPath,
      ],
      args.rcloneConfigPath,
      true,
    )
    logger.info(
      'engineer factory restore completed local_path="%s" remote_path="%s"',
      dir.localPath,
      dir.remotePath,
    )
  }
}

async function syncFactoryState(args: SyncFactoryStateArgs): Promise<void> {
  for (const dir of getBackupDirs(args.homeDir, args.factoryRoot)) {
    await mkdir(dir.localPath, { recursive: true })
    await runRclone(
      [
        "sync",
        dir.localPath,
        `${FACTORY_RCLONE_REMOTE}:${args.storageCredentials.bucket}/${dir.remotePath}`,
      ],
      args.rcloneConfigPath,
      false,
    )
  }
}

function getBackupDirs(
  homeDir: string,
  factoryRoot: string,
): { localPath: string; remotePath: string }[] {
  return [
    {
      localPath: factoryRoot,
      remotePath: `${ENGINEER_FACTORY_STORAGE_PREFIX}/root`,
    },
    ...OPENCODE_BACKUP_DIRS.map(dir => ({
      localPath: join(homeDir, dir.localPath),
      remotePath: `${ENGINEER_FACTORY_STORAGE_PREFIX}/${dir.remotePath}`,
    })),
  ]
}

async function writeRcloneConfig(
  configPath: string,
  credentials: StorageBucketCredentials,
): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true })
  await Bun.write(
    configPath,
    [
      `[${FACTORY_RCLONE_REMOTE}]`,
      "type = s3",
      "provider = Minio",
      "env_auth = false",
      `access_key_id = ${credentials.accessKey}`,
      `secret_access_key = ${credentials.secretKey}`,
      `endpoint = ${credentials.endpoint}`,
      "",
    ].join("\n"),
  )
}

async function runRclone(
  args: string[],
  configPath: string,
  ignoreMissing: boolean,
): Promise<void> {
  try {
    await runCommand([
      "rclone",
      "--config",
      configPath,
      "--links",
      "--exclude",
      "**/node_modules/**",
      ...args,
    ])
  } catch (error) {
    if (ignoreMissing) {
      logger.warn(
        { error: normalizeError(error) },
        "engineer factory restore skipped missing backup",
      )
      return
    }

    throw error
  }
}

async function runCommand(command: string[]): Promise<string> {
  logger.info('engineer factory command started command="%s"', sanitizeCommand(command).join(" "))
  const process = Bun.spawn(command, {
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    process.stdout.text(),
    process.stderr.text(),
    process.exited,
  ])

  if (exitCode === 0) {
    return stdout
  }

  throw new Error(`Command failed: ${sanitizeCommand(command).join(" ")}; stderr: ${stderr.trim()}`)
}

async function createAuthenticatedCloneUrl(
  github: Awaited<ReturnType<typeof startGitHubService>>,
  cloneUrl: string,
): Promise<string> {
  const token = await createGitHubInstallationToken(github)

  return cloneUrl.replace(
    "https://github.com/",
    `https://x-access-token:${encodeURIComponent(token)}@github.com/`,
  )
}

async function createGitHubInstallationToken(
  github: Awaited<ReturnType<typeof startGitHubService>>,
): Promise<string> {
  const octokit = await github.getOctokit()
  const authResult = await octokit.auth({
    type: "installation",
  })
  const token =
    typeof authResult === "object" && authResult !== null && "token" in authResult
      ? String(authResult.token ?? "").trim()
      : ""

  if (token.length === 0) {
    throw new Error("GitHub installation token is empty")
  }

  return token
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)

    return true
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false
    }

    throw error
  }
}

async function logRepositoryRestoreDebug(repositoryPath: string): Promise<void> {
  const repositoryExists = await pathExists(repositoryPath)
  const gitPath = join(repositoryPath, ".git")
  const gitExists = await pathExists(gitPath)
  const entries = repositoryExists ? await readDirectoryEntryNames(repositoryPath) : []
  const gitEntries = gitExists ? await readDirectoryEntryNames(gitPath) : []

  logger.info(
    'engineer factory repository restore debug repository_path="%s" repository_exists="%s" git_exists="%s" entries="%s" git_entries="%s"',
    repositoryPath,
    String(repositoryExists),
    String(gitExists),
    entries.join(","),
    gitEntries.join(","),
  )
}

async function readDirectoryEntryNames(path: string): Promise<string[]> {
  try {
    return (await readdir(path)).sort()
  } catch (error) {
    return [`<error:${normalizeError(error).message}>`]
  }
}

function sanitizeCommand(command: string[]): string[] {
  return command.map(part =>
    part.replace(/x-access-token:[^@\s]+@github\.com/gi, "x-access-token:***@github.com"),
  )
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error
  }

  return new Error(String(error))
}
