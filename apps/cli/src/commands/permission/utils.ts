import { getContractEntityByIdentity, getReplicasImplementingContract } from "@contracts/alpha.v1"
import type { AlphaData } from "@contracts/alpha.v1"
import type { GrantedPermissionSetList } from "@contracts/user-manager.v1"
import type { Logger } from "pino"
import type { PermissionGrantResult } from "@contracts/user-manager.v1"

export async function resolveContractGrantContext(
  alphaData: AlphaData,
  contractIdentity: string,
  permissionName: string,
) {
  const contractEntity = await getContractEntityByIdentity(alphaData, contractIdentity)
  if (!contractEntity) {
    throw new Error(`Contract with identity "${contractIdentity}" not found in the cluster`)
  }

  const loadedContractEntity = await contractEntity.$jazz.ensureLoaded({
    resolve: {
      permissions: { $each: true },
    },
  })

  const permission = loadedContractEntity.permissions[permissionName]
  if (!permission) {
    throw new Error(`Permission "${permissionName}" not found in contract "${contractIdentity}"`)
  }

  const replicas = await getReplicasImplementingContract(alphaData, contractEntity.id)
  if (replicas.length === 0) {
    throw new Error(
      `No replicas found implementing contract "${contractIdentity}" (${contractEntity.id})`,
    )
  }

  return { contractEntity, permission, replicas }
}

export function logPermissionSets(
  logger: Logger,
  permissionSets: GrantedPermissionSetList,
  options: {
    logHeader: () => void
    logEmpty: () => void
  },
): void {
  let hasPermissionSets = false

  for (const permissionSet of permissionSets.values()) {
    if (!permissionSet.$isLoaded) {
      continue
    }

    if (!hasPermissionSets) {
      options.logHeader()
      hasPermissionSets = true
    }

    logger.info("- Permission Set")

    if (permissionSet.replicas.$isLoaded) {
      for (const replica of permissionSet.replicas.values()) {
        if (!replica.$isLoaded) {
          continue
        }

        logger.info("  - Replica: %s (ID: %d)", replica.name, replica.id)
      }
    }

    if (permissionSet.permissions.$isLoaded) {
      for (const grantedPermission of permissionSet.permissions.values()) {
        if (!grantedPermission.$isLoaded) {
          continue
        }

        const permission = grantedPermission.permission
        if (!permission?.$isLoaded) {
          continue
        }

        logger.info("  - Permission: %s", permission.name)

        const params = grantedPermission.params ?? {}
        if (Object.keys(params).length > 0) {
          if (grantedPermission.instanceId) {
            logger.info("    - Instance ID: %s", grantedPermission.instanceId)
          }

          logger.info("    - Params: %o", params)
        }
      }
    }
  }

  if (!hasPermissionSets) {
    options.logEmpty()
  }
}

export function logGrantResult(
  logger: Logger,
  result: PermissionGrantResult,
  info: {
    contractIdentity: string
    permissionName: string
    targetDescription: string
  },
): void {
  const { contractIdentity, permissionName, targetDescription } = info

  if (result.action === "duplicate") {
    logger.info(
      { success: true },
      `permission "${permissionName}" from contract "${contractIdentity}" already exists ${targetDescription}, skipping duplicate`,
    )
    return
  }

  if (result.action === "added") {
    logger.info(
      { success: true },
      `added permission "${permissionName}" from contract "${contractIdentity}" to existing permission set ${targetDescription}`,
    )
    return
  }

  logger.info(
    { success: true },
    `created new permission set and granted permission "${permissionName}" from contract "${contractIdentity}" ${targetDescription}`,
  )
}
