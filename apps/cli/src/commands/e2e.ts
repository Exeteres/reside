import { defineCommand } from "citty"
import { readRequestedReplicas, runProvisionFlow } from "../shared/bootstrap-flow"

function readRequiredClusterDomainFromEnv(): string {
  const clusterDomain = process.env.RESIDE_CLUSTER_DOMAIN?.trim()
  if (!clusterDomain || clusterDomain.length === 0) {
    throw new Error(
      '"RESIDE_CLUSTER_DOMAIN" environment variable must be set locally before running "reside e2e"',
    )
  }

  return clusterDomain
}

export const e2eCommand = defineCommand({
  meta: {
    description: "Bootstrap a kind cluster and run replica e2e jobs.",
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
    cluster: {
      type: "string",
      description: "The kind cluster name to use.",
      default: "reside-e2e",
    },
    recreate: {
      type: "boolean",
      description: "Recreate the kind cluster before bootstrapping.",
      default: false,
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
  },
  async run({ args }) {
    const requestedReplicas = readRequestedReplicas(args)
    const clusterDomain = readRequiredClusterDomainFromEnv()

    await runProvisionFlow({
      ask: args.ask,
      clusterName: args.cluster,
      clusterDomain,
      installGatewayApi: true,
      only: args.only,
      skipBase: args["skip-base"],
      recreate: args.recreate,
      requestedReplicas,
      runE2E: true,
      silent: args.silent,
      textOutput: args.text,
      topologyPath: args.topology,
    })
  },
})
