import { defineCommand } from "citty"
import { discoverRequirement } from "@contracts/alpha.v1"
import { getUserById, UserManagerContract } from "@contracts/user-manager.v1"
import { contextArgs, createJazzContextForCurrentContext, logger } from "../../shared"
import { logPermissionSets } from "./utils"

export const listPermissionsCommand = defineCommand({
  meta: {
    description: "Lists all permission sets of the specified user in the cluster.",
  },
  args: {
    ...contextArgs,
    userId: {
      type: "positional",
      description: "The ID of the user to list permission sets for.",
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

    const loadedUser = await user.$jazz.ensureLoaded({
      resolve: {
        account: {
          profile: {
            $onError: "catch",
          },
        },
        permissionSets: {
          $each: {
            contract: true,
            replicas: { $each: true },
            permissions: { $each: { permission: true } },
          },
        },
      },
    })

    if (!loadedUser.permissionSets.$isLoaded) {
      throw new Error("Failed to load user permission sets")
    }

    const profileName = loadedUser.account.profile.$isLoaded
      ? loadedUser.account.profile.name
      : "unknown"

    logPermissionSets(logger, loadedUser.permissionSets, {
      logHeader: () =>
        logger.info("listing permission sets for user %s (ID: %d):", profileName, user.id),
      logEmpty: () => logger.info("user %s (ID: %d) has no permission sets", profileName, user.id),
    })

    await logOut()
  },
})
