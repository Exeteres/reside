import { defineCommand } from "citty"
import { readRequestedReplicas, runProvisionFlow } from "../shared/bootstrap-flow"

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
      context: args.context,
      only: args.only,
      skipBase: args.skipBase,
      requestedReplicas,
      runE2E: false,
      silent: args.silent,
      textOutput: args.text,
      topologyPath: args.topology,
    })
  },
})
