import { defineCommand } from "citty"
import { discoverRequirement } from "@contracts/alpha.v1"
import { UserManagerContract } from "@contracts/user-manager.v1"
import { contextArgs, createJazzContextForCurrentContext, logger } from "../../../shared"
import { logPermissionSets } from "../utils"

export const listDefaultPermissionsCommand = defineCommand({
  meta: {
    description: "Lists default permission sets applied to all users in the cluster.",
  },
  args: {
    ...contextArgs,
  },

  async run({ args }) {
    const { alpha, logOut } = await createJazzContextForCurrentContext(args.context)
    const userManager = await discoverRequirement(alpha.data, UserManagerContract)

    const loadedUserManager = await userManager.data.$jazz.ensureLoaded({
      resolve: {
        defaultPermissionSets: {
          $each: {
            contract: true,
            replicas: { $each: true },
            permissions: { $each: { permission: true } },
          },
        },
      },
    })

    const { defaultPermissionSets } = loadedUserManager

    if (!defaultPermissionSets.$isLoaded) {
      throw new Error("Failed to load default permission sets")
    }

    logPermissionSets(logger, defaultPermissionSets, {
      logHeader: () => logger.info("listing default permission sets:"),
      logEmpty: () => logger.info("no default permission sets configured"),
    })

    await logOut()
  },
})
