import { defineCommand } from "citty"
import { contextArgs, createJazzContextForCurrentContext, logger } from "../../shared"
import {
  getContractEntityByIdentity,
  getReplicasImplementingContract,
  discoverRequirement,
  GrantedPermission,
} from "@contracts/alpha.v1"
import {
  createGrantedPermissionSet,
  getUserById,
  UserManagerContract,
} from "@contracts/user-manager.v1"

export const grantPermissionCommand = defineCommand({
  meta: {
    description:
      "Grants the specified permission of the specified contract to the specified user in the cluster.",
  },
  args: {
    ...contextArgs,
    contractIdentity: {
      type: "positional",
      description: "The identity of the contract to grant permission from.",
      required: true,
    },
    permissionName: {
      type: "positional",
      description: "The name of the permission within the contract to grant.",
      required: true,
    },
    userId: {
      type: "positional",
      description: "The ID of the user to grant the permission to.",
      required: true,
    },
  },

  async run({ args }) {
    const userId = Number(args.userId)
    if (Number.isNaN(userId) || userId <= 0) {
      throw new Error(`Invalid user ID "${args.userId}", must be a positive number`)
    }

    const { alpha, logOut } = await createJazzContextForCurrentContext(args.context)

    const contractEntity = await getContractEntityByIdentity(alpha.data, args.contractIdentity)
    if (!contractEntity) {
      throw new Error(`Contract with identity "${args.contractIdentity}" not found in the cluster`)
    }

    const loadedContractEntity = await contractEntity.$jazz.ensureLoaded({
      resolve: {
        permissions: { $each: true },
      },
    })

    const permission = loadedContractEntity.permissions[args.permissionName]
    if (!permission) {
      throw new Error(
        `Permission "${args.permissionName}" not found in contract "${args.contractIdentity}"`,
      )
    }

    const userManager = await discoverRequirement(alpha.data, UserManagerContract)
    const user = await getUserById(userManager.data, userId)
    if (!user) {
      throw new Error(`User with ID ${userId} not found in the User Manager Replica`)
    }

    const loadedUser = await user.$jazz.ensureLoaded({
      resolve: {
        permissionSets: {
          $each: {
            contract: true,
            replicas: { $each: true },
            permissions: { $each: { permission: true } },
          },
        },
      },
    })

    const replicas = await getReplicasImplementingContract(alpha.data, contractEntity.id)

    if (replicas.length === 0) {
      throw new Error(
        `No replicas found implementing contract "${args.contractIdentity}" (${contractEntity.id})`,
      )
    }

    // find existing permission set for this contract
    const existingPermissionSet = loadedUser.permissionSets.find(
      ps => ps.contract.id === contractEntity.id,
    )

    const newPermission = GrantedPermission.create({
      requestType: "manual",
      status: "approved",
      permission,
      instanceId: undefined,
      params: {},
    })

    if (existingPermissionSet) {
      // add permission to existing set
      newPermission.$jazz.owner.addMember(existingPermissionSet.$jazz.owner, "reader")
      existingPermissionSet.permissions.$jazz.push(newPermission)

      logger.info(
        { success: true },
        `added permission "${args.permissionName}" from contract "${args.contractIdentity}" to existing permission set for user ID ${userId}`,
      )
    } else {
      // create new permission set
      await createGrantedPermissionSet(loadedUser.permissionSets, contractEntity, replicas, [
        newPermission,
      ])

      logger.info(
        { success: true },
        `created new permission set and granted permission "${args.permissionName}" from contract "${args.contractIdentity}" to user ID ${userId}`,
      )
    }

    await logOut()
  },
})
