import { getReplicaById } from "@contracts/alpha.v1"
import { defineCommand } from "citty"
import { contextArgs, createJazzContextForCurrentContext, logger } from "../../shared"

export const updateReplicaPlacementGroupCommand = defineCommand({
  meta: {
    description: "Sets or clears the placement group for the specified replica.",
  },
  args: {
    ...contextArgs,
    replicaId: {
      type: "positional",
      description: "The ID of the replica to update.",
      required: true,
    },
    placementGroup: {
      type: "positional",
      description: "The placement group name. Omit this argument to reset the placement group.",
      required: false,
    },
  },

  async run({ args }) {
    const { alpha, logOut } = await createJazzContextForCurrentContext(args.context)

    try {
      const replicaId = Number(args.replicaId)
      if (Number.isNaN(replicaId)) {
        throw new Error(`Invalid replica ID: ${args.replicaId}`)
      }

      const replica = await getReplicaById(alpha.data, replicaId)
      if (!replica) {
        throw new Error(`Replica with ID ${replicaId} not found.`)
      }

      const loadedReplica = await replica.$jazz.ensureLoaded({ resolve: { management: true } })

      const placementGroup = args.placementGroup?.length ? args.placementGroup : undefined
      loadedReplica.management.$jazz.set("placementGroup", placementGroup)

      if (placementGroup) {
        logger.info(`replica "%s" placement group set to "%s"`, loadedReplica.name, placementGroup)
      } else {
        logger.info(`replica "%s" placement group reset`, loadedReplica.name)
      }
    } finally {
      await logOut()
    }
  },
})
