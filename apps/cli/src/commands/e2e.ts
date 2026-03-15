import { defineCommand } from "citty"
import { readRequestedReplicas, runProvisionFlow } from "../shared/bootstrap-flow"

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
    skipBase: {
      type: "boolean",
      description: "Skip cluster provisioning and base prerequisites.",
      default: false,
    },
  },
  async run({ args }) {
    const requestedReplicas = readRequestedReplicas(args)

    await runProvisionFlow({
      ask: args.ask,
      clusterName: args.cluster,
      only: args.only,
      skipBase: args.skipBase,
      recreate: args.recreate,
      requestedReplicas,
      runE2E: true,
      silent: args.silent,
      textOutput: args.text,
      topologyPath: args.topology,
    })
  },
})
