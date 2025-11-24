import type { Logger } from "pino"
import { resolve } from "node:path"
import { CommonReplicaConfig, loadConfig } from "@reside/shared"
import { getPort } from "get-port-please"

export async function startStatusBoard(alphaReplicaId: string, logger: Logger): Promise<string> {
  const statusboardRoot = resolve(process.cwd(), "../../apps/statusboard")

  logger.info("statusboard root: %s", statusboardRoot)

  const port = await getPort()
  const endpoint = `http://localhost:${port}`

  const config = loadConfig(CommonReplicaConfig)

  Bun.spawn(["bun", "dev", "--port", port.toString()], {
    cwd: statusboardRoot,
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...process.env,
      VITE_ACCOUNT_ID: config.RESIDE_ACCOUNT_ID,
      VITE_AGENT_SECRET: config.RESIDE_AGENT_SECRET,
      VITE_JAZZ_SYNC_SERVER_URL: config.RESIDE_SYNC_SERVER_URL,
      VITE_ALPHA_REPLICA_ID: alphaReplicaId,
    },
  })

  logger.info(`statusboard started at "%s"`, endpoint)

  return endpoint
}
