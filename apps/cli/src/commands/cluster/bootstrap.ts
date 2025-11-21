import { defineCommand } from "citty"
import { loadLocalConfig, logger, saveLocalConfig } from "../../shared"
import { runCommand } from "@reside/shared"
import { resolve } from "node:path"
import { sleep } from "bun"
import { readFile } from "node:fs/promises"

export const bootstrapClusterCommand = defineCommand({
  meta: {
    description:
      "Bootstrap a new Reside cluster on a Kubernetes cluster, optionally creating a local kind cluster first.",
  },

  args: {
    name: {
      type: "positional",
      description: "The name of the cluster to bootstrap.",
      required: true,
    },
    namespace: {
      type: "string",
      description:
        "The Kubernetes namespace to bootstrap the Reside cluster in. If not specified, defaults to 'reside'.",
      required: false,
      default: "reside",
    },
    "create-local": {
      type: "boolean",
      description:
        "Whether to bootstrap a local Kubernetes cluster using kind and bootstrap Reside cluster on it. If not specified, assumes bootstrapping on an existing cluster currently pointed to by kubectl.",
      required: false,
      default: false,
    },
    "kube-context": {
      type: "string",
      description:
        "The kubeconfig context to use when bootstrapping the cluster. If not specified, uses the current context.",
      required: false,
    },
    "delete-local": {
      type: "boolean",
      description:
        "Whether to delete the local kind cluster before bootstrapping. Only applicable if --local is set.",
      required: false,
      default: false,
    },
    clear: {
      type: "boolean",
      description:
        "Whether to clear existing Reside cluster before bootstrap. Applicable for all cluster types.",
      required: false,
      default: false,
    },
    override: {
      type: "boolean",
      description: "Whether to override existing Reside cluster in the local configuration.",
      required: false,
      default: false,
    },
    endpoint: {
      type: "string",
      description:
        "The endpoint of the Reside cluster to connect to sync server and replicas. Must not contain protocol or path: only host and optional port.",
      required: true,
    },
  },

  async run({ args }) {
    if (args["create-local"]) {
      logger.info(`bootstrapping local kind cluster "%s"`, args.name)

      if (args["delete-local"]) {
        // -1. delete existing kind cluster if any
        logger.info(`deleting existing kind cluster "%s" if any`, args.name)

        await runCommand(["kind", "delete", "cluster", "--name", args.name])
      }

      // 0. create kind cluster if local
      await runCommand(["kind", "create", "cluster", "--name", args.name])

      // 1. install ingress-nginx controller
      logger.info(`installing ingress-nginx controller in kind cluster "%s"`, args.name)

      await runCommand([
        "kubectl",
        "apply",
        "-f",
        "https://kind.sigs.k8s.io/examples/ingress/deploy-ingress-nginx.yaml",
      ])

      args["kube-context"] = `kind-${args.name}`
    }

    let kubeContext = args["kube-context"]
    if (!kubeContext) {
      // get current context
      const currentContextProc = Bun.spawn(["kubectl", "config", "current-context"], {
        stdout: "pipe",
      })

      const exitCode = await currentContextProc.exited
      if (exitCode !== 0) {
        throw new Error("Failed to get current kubectl context")
      }

      const contextOutput = await currentContextProc.stdout!.text()
      kubeContext = contextOutput.trim()
    }

    if (args.clear) {
      logger.info(`clearing existing Reside cluster in namespace "%s"`, args.namespace)

      // delete reside namespace if exists
      await runCommand([
        "kubectl",
        "--context",
        kubeContext,
        "delete",
        "namespace",
        args.namespace,
        "--ignore-not-found",
      ])
    }

    const localConfig = await loadLocalConfig()

    if (!args.override && localConfig.clusters.find(c => c.name === args.name)) {
      throw new Error(
        `Cluster with name "${args.name}" already exists in local configuration. Use --override to override.`,
      )
    }

    if (!args.override && localConfig.contexts.find(c => c.name === args.name)) {
      throw new Error(
        `Context with name "${args.name}" already exists in local configuration. Use --override to override.`,
      )
    }

    logger.info(`bootstrapping reside cluster in namespace "%s"`, args.namespace)

    // 1. create namespace
    await runCommand(["kubectl", "--context", kubeContext, "create", "namespace", args.namespace])

    // 2. apply bootstrap manifests
    const manifestPath = resolve(import.meta.dir, "../../../assets/seed.yaml")
    const manifestContent = await readFile(manifestPath, "utf-8")

    const renderedManifest = manifestContent
      // biome-ignore lint/suspicious/noTemplateCurlyInString: it's intended
      .replace("${RESIDE_EXTERNAL_ENDPOINT}", args.endpoint)

    const applyProc = Bun.spawn(
      ["kubectl", "--context", kubeContext, "apply", "-n", args.namespace, "-f", "-"],
      { stdin: "pipe" },
    )

    applyProc.stdin!.write(renderedManifest)
    applyProc.stdin!.end()

    const applyExitCode = await applyProc.exited
    if (applyExitCode !== 0) {
      throw new Error("Failed to apply Seed Replica manifests")
    }

    logger.info({ success: true }, "applied Seed Replica manifests")

    while (true) {
      logger.info("waiting for Seed Replica to start...")

      await Bun.sleep(2_000)

      const phaseProc = Bun.spawn(
        [
          "kubectl",
          "--context",
          kubeContext,
          "get",
          "-n",
          "reside",
          "pod",
          "-l",
          "reside.io/replica=seed",
          "-o",
          "jsonpath={.items[0].status.phase}",
        ],
        { stderr: "pipe" },
      )

      const exitCode = await phaseProc.exited
      if (exitCode !== 0) {
        const errOutput = await phaseProc.stderr!.text()
        logger.debug("failed to get seed pod phase: %s", errOutput.trim())
        continue
      }

      const phaseOutput = await phaseProc.stdout!.text()
      const phase = phaseOutput.trim()

      if (phase === "Running") {
        break
      }

      if (phase === "Failed") {
        throw new Error("Seed Replica pod phase is Failed")
      }

      if (phase) {
        logger.debug("seed pod phase: %s", phase)
      }
    }

    // attach to seed logs and wait for initialization to complete
    logger.info("attaching to Seed Replica logs...")

    await runCommand([
      "bash",
      "-c",
      `kubectl --context ${kubeContext} -n ${args.namespace} logs job/seed-1 --follow | bun pino-pretty`,
    ])

    await Bun.sleep(4_000)

    // validate that the seed job completed successfully
    const statusProc = Bun.spawn([
      "kubectl",
      "--context",
      kubeContext,
      "get",
      "-n",
      "reside",
      "job",
      "seed-1",
      "-o",
      "jsonpath={.status.succeeded}",
    ])

    const exitCode = await statusProc.exited
    if (exitCode !== 0) {
      throw new Error("Failed to get Seed Replica status")
    }

    const statusOutput = await statusProc.stdout!.text()
    const succeeded = statusOutput.trim()

    if (succeeded !== "1") {
      throw new Error("Seed Replica did not complete successfully")
    }

    logger.info("Seed Replica has completed")

    // 3. add cluster to local config
    localConfig.clusters = localConfig.clusters.filter(c => c.name !== args.name)

    const alphaReplicaIdProc = Bun.spawn([
      "kubectl",
      "--context",
      kubeContext,
      "-n",
      args.namespace,
      "get",
      "secret",
      "alpha",
      "--template={{.data.accountId}}",
    ])

    const alphaExitCode = await alphaReplicaIdProc.exited
    if (alphaExitCode !== 0) {
      throw new Error("Failed to get Alpha Replica account ID")
    }

    const alphaReplicaIdOutput = await alphaReplicaIdProc.stdout!.text()
    const alphaReplicaId = Buffer.from(alphaReplicaIdOutput.trim(), "base64").toString("utf-8")

    logger.info("Alpha Replica account ID: %s", alphaReplicaId)

    localConfig.clusters.push({
      name: args.name,
      namespace: args.namespace,
      kubeContext,
      alphaReplicaId,
      endpoint: args.endpoint,
    })

    const account = localConfig.accounts[0]
    if (account) {
      // also create context for the cluster
      localConfig.contexts = localConfig.contexts.filter(c => c.name !== args.name)

      localConfig.contexts.push({
        name: args.name,
        account: account.name,
        cluster: args.name,
      })

      localConfig.currentContext = args.name

      logger.info(
        `created context "%s" for cluster "%s" with account "%s" and set as current context`,
        args.name,
        args.name,
        account.name,
      )
    } else {
      logger.warn(
        "no account found in local configuration, skipping context creation for the new cluster",
      )
    }

    await saveLocalConfig(localConfig)

    logger.info({ success: true }, "successfully bootstrapped Reside cluster")
    await sleep(10_000)

    // 4. claim super admin access to the cluster
    await runCommand(["reside", "cluster", "claim-super-admin-access", "--context", args.name])
  },
})
