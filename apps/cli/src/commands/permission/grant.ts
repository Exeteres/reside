import { discoverRequirement } from "@contracts/alpha.v1"
import { getUserById, grantPermissionToUser, UserManagerContract } from "@contracts/user-manager.v1"
import { defineCommand } from "citty"
import { contextArgs, createJazzContextForCurrentContext, logger } from "../../shared"
import { logGrantResult, promptForPermissionParams, resolveContractGrantContext } from "./utils"

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

    const { contractEntity, permission, replicas } = await resolveContractGrantContext(
      alpha.data,
      args.contractIdentity,
      args.permissionName,
    )

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

    const params = await promptForPermissionParams(permission, logger)

    const result = await grantPermissionToUser(
      loadedUser,
      contractEntity,
      permission,
      replicas,
      params,
    )

    logGrantResult(logger, result, {
      contractIdentity: args.contractIdentity,
      permissionName: args.permissionName,
      targetDescription: `for user ID ${userId}`,
    })

    await logOut()
  },
})
