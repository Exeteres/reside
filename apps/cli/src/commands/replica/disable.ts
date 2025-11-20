import { defineCommand } from "citty"
import { contextArgs, createJazzContextForCurrentContext } from "../../shared"
import { getReplicaById } from "@contracts/alpha.v1"

export const disableReplicaCommand = defineCommand({
  meta: {
    description: "Disables a replica in the cluster.",
  },
  args: {
    ...contextArgs,
    replicaId: {
      type: "positional",
      description: "The ID of the replica to disable.",
      required: true,
    },
  },

  async run({ args }) {
    const { alpha, logOut } = await createJazzContextForCurrentContext(args.context)

    const replicaId = Number(args.replicaId)
    if (Number.isNaN(replicaId)) {
      throw new Error(`Invalid replica ID: ${args.replicaId}`)
    }

    const replica = await getReplicaById(alpha.data, replicaId)
    if (!replica) {
      throw new Error(`Replica with ID ${replicaId} not found.`)
    }

    const loadedReplica = await replica.$jazz.ensureLoaded({ resolve: { management: true } })

    loadedReplica.management.$jazz.set("enabled", false)
    await logOut()
  },
})
