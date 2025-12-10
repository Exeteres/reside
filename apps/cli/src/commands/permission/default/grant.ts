import type { Account } from "jazz-tools"
import { discoverRequirement } from "@contracts/alpha.v1"
import { grantPermissionToPermissionSetList, UserManagerContract } from "@contracts/user-manager.v1"
import { defineCommand } from "citty"
import { contextArgs, createJazzContextForCurrentContext, logger } from "../../../shared"
import { logGrantResult, resolveContractGrantContext } from "../utils"

export const grantDefaultPermissionCommand = defineCommand({
  meta: {
    description: "Grants the specified contract permission to default permission sets.",
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
  },

  async run({ args }) {
    const { alpha, logOut } = await createJazzContextForCurrentContext(args.context)

    const { contractEntity, permission, replicas } = await resolveContractGrantContext(
      alpha.data,
      args.contractIdentity,
      args.permissionName,
    )

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

    if (!loadedUserManager.defaultPermissionSets.$isLoaded) {
      throw new Error("Failed to load default permission sets")
    }

    const ownerAccount = userManager.data.$jazz.loadedAs as Account

    const result = await grantPermissionToPermissionSetList(
      loadedUserManager.defaultPermissionSets,
      contractEntity,
      permission,
      replicas,
      ownerAccount,
      {},
    )

    logGrantResult(logger, result, {
      contractIdentity: args.contractIdentity,
      permissionName: args.permissionName,
      targetDescription: "in default permission sets",
    })

    await logOut()
  },
})
