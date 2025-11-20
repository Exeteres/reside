import { defineCommand } from "citty"
import { contextArgs, logger, resolveCurrentContextConfig } from "../../shared"
import { runCommand } from "@reside/shared"

export const clusterLogsCommand = defineCommand({
  meta: {
    description: "Shows the logs for the Reside cluster components and replicas.",
  },

  args: {
    ...contextArgs,
    component: {
      type: "positional",
      description:
        "The component to show logs for (e.g., jazz, etcd, seed or any other replica in format {name}-{version}).",
      required: true,
    },
  },

  async run({ args }) {
    let type: string
    if (["jazz", "etcd"].includes(args.component)) {
      type = "statefulset"
    } else if (args.component === "seed") {
      type = "job"
    } else {
      type = "deployment"
    }

    const { cluster } = await resolveCurrentContextConfig(args.context)

    logger.info(`streaming logs for component "%s" in cluster "%s"`, args.component, cluster.name)

    await runCommand([
      "bash",
      "-c",
      `kubectl logs --context ${cluster.kubeContext} -n ${cluster.namespace} --follow ${type}/${args.component} | bun pino-pretty`,
    ])
  },
})
