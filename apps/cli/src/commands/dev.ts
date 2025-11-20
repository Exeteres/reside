import { defineCommand } from "citty"
import {
  contextArgs,
  createJazzContextForCurrentContext,
  getJazzEndpoint,
  loadPackageConfig,
  logger,
} from "../shared"
import {
  getReplicaById,
  getReplicasByIdentity,
  waitForReplicaStatus,
  type Replica,
} from "@contracts/alpha.v1"
import { startTunnel } from "untun"
import { getPort } from "get-port-please"

export const devCommand = defineCommand({
  meta: {
    description:
      "Runs the replica in dev mode: disables it in the cluster and impersonates it locally.",
  },
  args: {
    ...contextArgs,
    replicaId: {
      type: "string",
      description:
        "The ID of the replica to impersonate. If not provided, will detect automatically by identity.",
      required: false,
    },
  },

  async run({ args }) {
    const config = await loadPackageConfig(logger)
    logger.info(`starting dev mode for "%s"`, config.manifest.identity)

    const { alpha, cluster, logOut } = await createJazzContextForCurrentContext(args.context)

    // 1. fetch replica entity
    let replica: Replica
    if (args.replicaId) {
      const replicaId = Number(args.replicaId)
      if (Number.isNaN(replicaId)) {
        throw new Error(`Invalid replica ID: ${args.replicaId}`)
      }

      const foundReplica = await getReplicaById(alpha.data, replicaId)
      if (!foundReplica) {
        throw new Error(`Replica with ID ${replicaId} not found.`)
      }

      replica = foundReplica
    } else {
      const foundReplica = await getReplicasByIdentity(alpha.data, config.manifest.identity)
      if (foundReplica.length === 0) {
        throw new Error(
          `No replica with identity "${config.manifest.identity}" found in the cluster.`,
        )
      }

      if (foundReplica.length > 1) {
        throw new Error(
          `Multiple replicas with identity "${config.manifest.identity}" found in the cluster. Please specify replica ID explicitly.`,
        )
      }

      replica = foundReplica[0]!
    }

    const loadedReplica = await replica.$jazz.ensureLoaded({
      resolve: {
        management: true,
        currentVersion: true,
      },
    })

    // 2. fetch replica credentials to impersonate
    const secretCmd = Bun.spawnSync([
      "kubectl",
      "get",
      "secret",
      loadedReplica.name,
      "-n",
      cluster.namespace,
      "--context",
      cluster.kubeContext,
      "-o",
      "jsonpath={.data}",
    ])

    if (secretCmd.exitCode !== 0) {
      throw new Error(
        `Failed to fetch secret for replica "${loadedReplica.name}": ${secretCmd.stderr.toString()}`,
      )
    }

    const secretData = JSON.parse(secretCmd.stdout.toString())
    const accountId = Buffer.from(secretData.accountId, "base64").toString("utf-8")
    const agentSecret = Buffer.from(secretData.agentSecret, "base64").toString("utf-8")

    const deploymentEnvCmd = Bun.spawnSync([
      "kubectl",
      "get",
      "deployment",
      `${loadedReplica.name}-${loadedReplica.currentVersion!.id}`,
      "-n",
      cluster.namespace,
      "--context",
      cluster.kubeContext,
      "-o",
      "jsonpath={.spec.template.spec.containers[0].env}",
    ])

    if (deploymentEnvCmd.exitCode !== 0) {
      throw new Error(
        `Failed to fetch deployment for replica "${loadedReplica.name}": ${deploymentEnvCmd.stderr.toString()}`,
      )
    }

    const envVarsOutput = JSON.parse(deploymentEnvCmd.stdout.toString()) as Array<{
      name: string
      value?: string
    }>

    const rcbId = envVarsOutput.find(env => env.name === "RESIDE_CONTROL_BLOCK_ID")?.value
    if (!rcbId) {
      throw new Error(
        `Failed to find RESIDE_CONTROL_BLOCK_ID env var for replica "${loadedReplica.name}"`,
      )
    }

    logger.info(
      `impersonating replica "%s" (account ID: %s, RCB: %s)`,
      loadedReplica.name,
      accountId,
      rcbId,
    )

    // 3. disable replica in the cluster
    loadedReplica.management.$jazz.set("enabled", false)

    logger.info(`replica "%s" disabled in the cluster, waiting for shutdown...`, loadedReplica.name)

    let lastReplicaStatus: string = loadedReplica.currentVersion!.status
    for await (const updatedReplica of waitForReplicaStatus(
      alpha.data,
      loadedReplica.id,
      "stopped",
    )) {
      if (lastReplicaStatus !== updatedReplica.currentVersion!.status) {
        lastReplicaStatus = updatedReplica.currentVersion!.status
        logger.info(`replica "%s" status: %s`, loadedReplica.name, lastReplicaStatus)
      }
    }

    // 4. start tunnel for RPC

    const port = await getPort({ port: 8080 })
    const tunnel = await startTunnel({ port, acceptCloudflareNotice: true })
    if (!tunnel) {
      throw new Error(`Failed to start tunnel for RPC server`)
    }

    const url = await tunnel.getURL()
    logger.info(`started tunnel for RPC server at "%s"`, url)

    logger.info(`launching replica locally...`)

    // 5. launch replica locally with impersonation env vars

    try {
      const devCmd = Bun.spawn(["bash", "-c", "bun --watch src/main.ts | bunx pino-pretty"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          RESIDE_CONTROL_BLOCK_ID: rcbId,
          RESIDE_ACCOUNT_ID: accountId,
          RESIDE_AGENT_SECRET: agentSecret,
          RESIDE_SYNC_SERVER_URL: getJazzEndpoint(cluster.endpoint),
          RESIDE_ENDPOINT: cluster.endpoint,
          RESIDE_RPC_SERVER_URL: url,
          RESIDE_LISTEN_PORT: port.toString(),
        },
        stdin: "inherit",
        stdout: "inherit",
      })

      process.on("SIGINT", () => {
        // forward SIGINT to the replica process
        devCmd.kill("SIGINT")
      })

      await devCmd.exited

      if (devCmd.exitCode !== 0) {
        throw new Error(`Replica process exited with code ${devCmd.exitCode}`)
      }
    } finally {
      logger.info(
        `dev replica shutting down, re-enabling replica "%s" in the cluster...`,
        loadedReplica.name,
      )
      loadedReplica.management.$jazz.set("enabled", true)

      await logOut()
    }
  },
})
