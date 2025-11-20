import { AlphaContract, getLoadRequestById } from "@contracts/alpha.v1"
import { startReplica } from "@reside/shared"
import { type Account, co, JazzRequestError } from "jazz-tools"
import { syncControlBlockPermissions } from "./control-block"
import { setupKubernetesDeploymentReconciliation } from "./kubernetes-monitor"
import { createLoadRequest, validateLoadRequest } from "./load-request"
import { AlphaReplica } from "./replica"
import { createReplicaVersionFromLoadRequest } from "./replica-management"
import { setupReplicaStatusReconcilation } from "./replica-status-monitor"
import { createSuperAdminPermissionSet } from "./super-admin"

const {
  replicaId,
  implementations: { alpha },
  requirements: { k8s },
  lockService,
  logger,
} = await startReplica(AlphaReplica)

alpha.handleCreateLoadRequest(async ({ input }, madeBy) => {
  return await lockService.transaction(AlphaContract.data, alpha.data, async data => {
    if (!alpha.checkPermission(madeBy, "load-request:create")) {
      throw new JazzRequestError("Permission denied to create load request", 403)
    }

    const loadRequest = await createLoadRequest(data, input, madeBy)

    // launch validation asynchronously in another transaction
    // we cannot launch it in the main context because the data updated by this transaction will not be visible there yet
    void lockService.transaction(AlphaContract.data, data, async validateData => {
      try {
        const txLoadRequest = await getLoadRequestById(validateData, loadRequest.id)
        if (!txLoadRequest) {
          throw new Error(`Load request #${loadRequest.id} not found in validation transaction`)
        }

        await validateLoadRequest(validateData, txLoadRequest, logger)
      } catch (err) {
        logger.error({ err }, "failed to validate load request #%d", loadRequest.id)
      }
    })

    return { loadRequest }
  })
})

alpha.handleApproveLoadRequest(async ({ loadRequestId, requirementReplicaIds }, madeBy) => {
  return await lockService.transaction(AlphaContract.data, alpha.data, async data => {
    if (!alpha.checkPermission(madeBy, "load-request:approve")) {
      throw new JazzRequestError("Permission denied to approve load request", 403)
    }

    const loadRequest = await getLoadRequestById(data, loadRequestId)
    if (!loadRequest) {
      throw new JazzRequestError(`Load request with ID ${loadRequestId} not found`, 404)
    }

    const loadedLoadRequest = await loadRequest.$jazz.ensureLoaded({
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

    if (!loadedLoadRequest.approveRequest || !loadedLoadRequest.approveRequest.$isLoaded) {
      throw new JazzRequestError(
        `Load request with ID ${loadRequestId} is not in approvable state`,
        422,
      )
    }

    // mark load request as approved
    loadRequest.$jazz.set("status", "approved")

    // set selected replicas for each requirement
    for (const [requirementKey, replicaIds] of Object.entries(requirementReplicaIds)) {
      const requirement = loadedLoadRequest.approveRequest.requirements[requirementKey]
      if (!requirement) {
        throw new JazzRequestError(
          `Requirement with key "${requirementKey}" not found on load request`,
          400,
        )
      }

      for (const replicaId of replicaIds) {
        const replica = requirement.alternatives.find(r => r.id === replicaId)
        if (!replica) {
          throw new JazzRequestError(
            `Replica with ID "${replicaId}" not found in alternatives for requirement "${requirementKey}"`,
            400,
          )
        }
      }

      if (!requirement.optional && replicaIds.length === 0) {
        throw new JazzRequestError(
          `Requirement "${requirementKey}" is not optional and must have at least one replica assigned`,
          400,
        )
      }

      if (!requirement.multiple && replicaIds.length > 1) {
        throw new JazzRequestError(
          `Requirement "${requirementKey}" does not allow multiple replicas`,
          400,
        )
      }

      requirement.$jazz.set(
        "replicas",
        requirement.alternatives.filter(r => replicaIds.includes(r.id)),
      )
    }

    // create replica version for the approved load request
    const replicaVersion = await createReplicaVersionFromLoadRequest(
      data,
      k8s.data,
      loadedLoadRequest,
      logger,
    )

    return {
      loadRequest: loadedLoadRequest,
      replicaVersion,
    }
  })
})

alpha.handleRejectLoadRequest(async ({ loadRequestId, reason }, madeBy) => {
  return await lockService.transaction(AlphaContract.data, alpha.data, async data => {
    if (!alpha.checkPermission(madeBy, "load-request:approve")) {
      throw new JazzRequestError("Permission denied to reject load request", 403)
    }

    const loadRequest = await getLoadRequestById(data, loadRequestId)
    if (!loadRequest) {
      throw new JazzRequestError(`Load request with ID ${loadRequestId} not found`, 404)
    }

    // mark load request as rejected
    loadRequest.$jazz.set("status", "rejected")
    loadRequest.$jazz.set("rejectionReason", reason)

    return { loadRequest }
  })
})

alpha.handleClaimSuperAdminAccess(async (_, madeBy) => {
  return await lockService.transaction(AlphaContract.data, alpha.data, async data => {
    const loadedData = await data.$jazz.ensureLoaded({
      resolve: {
        superAdminAccount: true,
      },
    })

    if (loadedData.superAdminAccount) {
      throw new JazzRequestError("Super admin access has already been claimed", 403)
    }

    const transactionAccount = await co.account().load(madeBy.$jazz.id)
    if (!transactionAccount.$isLoaded) {
      throw new JazzRequestError(`Account with ID "${madeBy.$jazz.id}" not found`, 404)
    }

    // set super admin account to the claiming account
    data.$jazz.set("superAdminAccount", madeBy)

    // create temp permission sets for the super admin and sync it
    const alphaPermissionSet = await createSuperAdminPermissionSet(
      data,
      replicaId,
      data.$jazz.loadedAs as Account,
    )

    await syncControlBlockPermissions(data, transactionAccount, [alphaPermissionSet], logger)

    logger.info(`super admin access claimed by account "%s"`, madeBy.$jazz.id)
  })
})

await setupKubernetesDeploymentReconciliation(alpha.data, k8s.data, logger)
await setupReplicaStatusReconcilation(alpha.data, k8s.data, logger)

logger.info("Alpha Replica started")
