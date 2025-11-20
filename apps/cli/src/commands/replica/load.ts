import { defineCommand } from "citty"
import { contextArgs, logger, renderLoadRequest } from "../../shared"
import { createJazzContextForCurrentContext } from "../../shared/jazz"
import { createRequirement } from "@reside/shared"
import {
  AlphaContract,
  waitForLoadRequestValidation,
  waitForReplicaStabilization,
} from "@contracts/alpha.v1"
import { confirm } from "@inquirer/prompts"
import logUpdate from "log-update"
import { mapValues } from "remeda"
import boxen from "boxen"
import ora from "ora"
import type { Replica } from "@contracts/alpha.v1"
import { renderReplica } from "../../shared/replica"

export const loadReplicaCommand = defineCommand({
  meta: {
    description: "Creates load request for the replica and approves them if requested.",
  },

  args: {
    ...contextArgs,
    image: {
      type: "positional",
      description: "The image of the replica to load.",
      required: true,
    },
    name: {
      type: "string",
      description:
        "The name to assign to the loaded replica. If not specified, will be assigned automatically based on the replica manifest.",
      required: false,
    },
    "owner-id": {
      type: "string",
      description:
        "The account ID to assign as the owner of the loaded replica. If not specified, the replica will be owned by the current user.",
      required: false,
    },
    "replica-id": {
      type: "string",
      description:
        "The ID of the existing replica to update. Only applicable for non-exclusive replicas.",
      required: false,
    },
    "auto-approve": {
      type: "boolean",
      description: "Whether to automatically approve the load request if it passes validation.",
      required: false,
      default: false,
    },
  },

  cleanup: () => {
    logUpdate.done()
  },

  async run({ args }) {
    const { cluster, logOut } = await createJazzContextForCurrentContext(args.context)

    logger.info("creating load request for replica image %s...", args.image)

    const { data, createLoadRequest, approveLoadRequest, rejectLoadRequest } =
      await createRequirement(AlphaContract, cluster.alphaReplicaId, cluster.endpoint)

    const replicaId = args["replica-id"] ? Number(args["replica-id"]) : undefined
    if (replicaId !== undefined && Number.isNaN(replicaId)) {
      throw new Error(`Invalid replica id "${args["replica-id"]}", must be a number`)
    }

    const { loadRequest } = await createLoadRequest({
      input: {
        image: args.image,
        name: args.name,
        replicaId,
        ownerId: args["owner-id"],
      },
    })

    console.log()
    const spinner = ora({ spinner: "material" })
    let lastLoadRequest = loadRequest
    let loadRequestRendering = false
    let pendingLoadRequestRender = false

    const updateBox = async () => {
      if (loadRequestRendering) {
        pendingLoadRequestRender = true
        return
      }

      loadRequestRendering = true

      try {
        const rendered = await renderLoadRequest(lastLoadRequest)

        const title =
          lastLoadRequest.status === "validating"
            ? `Load Request #${lastLoadRequest.id} | ${spinner.frame()}`
            : `Load Request #${lastLoadRequest.id}`

        const boxed = boxen(rendered, {
          title: title,
          borderColor: "blue",
          borderStyle: "bold",
          padding: 1,
        })

        logUpdate(boxed)
      } finally {
        loadRequestRendering = false

        if (pendingLoadRequestRender) {
          pendingLoadRequestRender = false
          void updateBox()
        }
      }
    }

    const spinnerInterval = setInterval(() => {
      void updateBox()
    }, 120)

    try {
      for await (const updatedLR of waitForLoadRequestValidation(data, loadRequest.id)) {
        lastLoadRequest = updatedLR
        await updateBox()
      }
    } finally {
      clearInterval(spinnerInterval)
    }

    logUpdate.done()

    if (lastLoadRequest.status === "invalid") {
      logger.error({ error: new Error(lastLoadRequest.errorMessage) }, "load request is invalid")
      await logOut()
      return
    }

    let approve = args["auto-approve"]
    if (!approve) {
      approve = await confirm({
        message: "Do you want to approve this load request?",
        default: false,
      })
    }

    if (!approve) {
      await rejectLoadRequest({ loadRequestId: loadRequest.id, reason: "Rejected by user via CLI" })

      logger.info("rejected")
      await logOut()
      return
    }

    const loadedLoadRequest = await lastLoadRequest.$jazz.ensureLoaded({
      resolve: {
        approveRequest: {
          requirements: {
            $each: {
              contract: true,
              replicas: { $each: true },
              alternatives: { $each: true },
            },
          },
        },
      },
    })

    const { replicaVersion } = await approveLoadRequest({
      loadRequestId: loadRequest.id,
      requirementReplicaIds: mapValues(loadedLoadRequest.approveRequest!.requirements, req =>
        req.replicas.map(replica => replica.id),
      ),
    })

    logger.info(
      { success: true },
      `created version %d for replica "%s" (ID: %d)`,
      replicaVersion.id,
      replicaVersion.replica.name,
      replicaVersion.replica.id,
    )

    console.log()

    const replicaSpinner = ora({ spinner: "material" })
    let lastReplica: Replica | null = null
    let replicaStable = false

    const updateReplicaBox = async () => {
      if (!lastReplica) {
        return
      }

      const renderedReplica = await renderReplica(lastReplica)

      const title = replicaStable
        ? `Replica "${lastReplica.name}" stabilized`
        : `Replica "${lastReplica.name}" | ${replicaSpinner.frame()}`

      const boxed = boxen(renderedReplica, {
        title,
        borderColor: replicaStable ? "green" : "blue",
        borderStyle: "bold",
        padding: 1,
      })

      logUpdate(boxed)
    }

    const replicaInterval = setInterval(() => {
      void updateReplicaBox()
    }, 120)

    try {
      for await (const replica of waitForReplicaStabilization(data, replicaVersion.replica.id)) {
        lastReplica = replica
        await updateReplicaBox()
      }

      replicaStable = true
      await updateReplicaBox()
    } finally {
      clearInterval(replicaInterval)
      logUpdate.done()
    }

    logger.info(
      { success: true },
      `replica "%s" stabilized at version %d`,
      replicaVersion.replica.name,
      replicaVersion.id,
    )

    await logOut()
  },
})
