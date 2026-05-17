import { input } from "@inquirer/prompts"
import { defineCommand } from "citty"
import { readRequestedReplicas, runProvisionFlow } from "../shared/bootstrap-flow"

async function readClusterDomain(): Promise<string> {
  const clusterDomain = process.env.RESIDE_CLUSTER_DOMAIN?.trim()
  if (clusterDomain && clusterDomain.length > 0) {
    return clusterDomain
  }

  return await input({
    message: "Enter value for RESIDE_CLUSTER_DOMAIN",
    validate: value => (value.trim().length > 0 ? true : "RESIDE_CLUSTER_DOMAIN cannot be empty"),
  })
}

export const bootstrapCommand = defineCommand({
  meta: {
    description: "Bootstrap ReSide on an existing Kubernetes context.",
  },
  args: {
    silent: {
      type: "boolean",
      description: "Suppress task log output while keeping task rendering and failure dumps.",
      default: false,
    },
    text: {
      type: "boolean",
      description: "Use plain text task output instead of the interactive renderer.",
      default: false,
    },
    context: {
      type: "string",
      description: "The kubeconfig context to bootstrap.",
      required: true,
    },
    topology: {
      type: "string",
      description: "Optional path to the topology file.",
      required: false,
    },
    ask: {
      type: "boolean",
      description: "Ask whether to override existing secret and config map fields.",
      default: false,
    },
    replica: {
      type: "string",
      description: "Replica name to provision. Can be repeated or comma-separated.",
      required: false,
    },
    only: {
      type: "boolean",
      description:
        "Provision only explicitly requested replicas without dependencies or base resources.",
      default: false,
    },
    "skip-base": {
      type: "boolean",
      description: "Skip cluster provisioning and base prerequisites.",
      default: false,
    },
    build: {
      type: "boolean",
      description: "Build and push selected replica images with the latest tag before bootstrap.",
      default: false,
    },
    "grant-bootstrap-role": {
      type: "boolean",
      description:
        "Temporarily grant bootstrap-only cluster roles defined in topology during provisioning.",
      default: false,
    },
    "install-gateway-api": {
      type: "boolean",
      description: "Install Gateway API CRDs during bootstrap prerequisites setup.",
      default: false,
    },
    recreate: {
      type: "boolean",
      description: "Delete all Replica CRs and wait until all replica namespaces are removed.",
      default: false,
    },
  },
  async run({ args }) {
    const requestedReplicas = readRequestedReplicas(args)
    const clusterDomain = await readClusterDomain()

    await runProvisionFlow({
      ask: args.ask,
      clusterDomain,
      context: args.context,
      build: args.build,
      grantBootstrapRole: args["grant-bootstrap-role"],
      installGatewayApi: args["install-gateway-api"],
      only: args.only,
      skipBase: args["skip-base"],
      recreate: args.recreate,
      requestedReplicas,
      runE2E: false,
      silent: args.silent,
      textOutput: args.text,
      topologyPath: args.topology,
    })
  },
})
