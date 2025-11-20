import { defineCommand } from "citty"
import { contextArgs, createJazzContextForCurrentContext, logger } from "../../shared"
import { getUserById, UserManagerContract } from "@contracts/user-manager.v1"
import { discoverRequirement } from "@contracts/alpha.v1"

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

    const { cluster, alpha, logOut } = await createJazzContextForCurrentContext(args.context)

    const userManager = await discoverRequirement(alpha.data, UserManagerContract, cluster.endpoint)

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

    const profileName = loadedUser.account.profile.$isLoaded
      ? loadedUser.account.profile.name
      : "unknown"

    logger.info("listing permission sets for user %s (ID: %d):", profileName, user.id)

    for (const permissionSet of loadedUser.permissionSets.values()) {
      logger.info("- Permission Set")

      for (const replica of permissionSet.replicas.values()) {
        logger.info("  - Replica: %s (ID: %d)", replica.name, replica.id)
      }

      for (const permissionEntry of permissionSet.permissions.values()) {
        logger.info("  - Permission: %s", permissionEntry.permission.name)
        if (permissionEntry.params && Object.keys(permissionEntry.params).length > 0) {
          logger.info("    - Instance ID: %s", permissionEntry.instanceId)
          logger.info("    - Params: %o", permissionEntry.params)
        }
      }
    }

    await logOut()
  },
})
