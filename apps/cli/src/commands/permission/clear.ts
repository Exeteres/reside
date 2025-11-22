import { defineCommand } from "citty"
import { contextArgs, createJazzContextForCurrentContext, logger } from "../../shared"
import {
  discoverRequirement,
} from "@contracts/alpha.v1"
import {
  getUserById,
  UserManagerContract,
} from "@contracts/user-manager.v1"

export const clearPermissionCommand = defineCommand({
  meta: {
    description:"Clears all permissions of the specified user in the cluster.",
      
  },
  args: {
    ...contextArgs,
    userId: {
      type: "positional",
      description: "The ID of the user to clear permissions for.",
      required: true,
    },
  },

  async run({ args }) {
    const userId = Number(args.userId)
    if (Number.isNaN(userId) || userId <= 0) {
      throw new Error(`Invalid user ID "${args.userId}", must be a positive number`)
    }

    const { alpha, logOut } = await createJazzContextForCurrentContext(args.context)

    const userManager = await discoverRequirement(alpha.data, UserManagerContract)
    const user = await getUserById(userManager.data, userId)
    if (!user) {
      throw new Error(`User with ID ${userId} not found in the User Manager Replica`)
    }

    const loadedUser = await user.$jazz.ensureLoaded({ resolve: { permissionSets: true } })
    loadedUser.permissionSets.$jazz.splice(0, loadedUser.permissionSets.length)

    logger.info("cleared all permissions for user ID %d", userId)

    await logOut()
  },
})
