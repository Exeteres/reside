import { defineCommand } from "citty"
import { contextArgs, createJazzContextForCurrentContext, logger } from "../../shared"
import { runCommand } from "@reside/shared"
import { UserManagerContract } from "@contracts/user-manager.v1"
import { discoverRequirement } from "@contracts/alpha.v1"
import { sleep } from "bun"

export const loadUserManagerCommand = defineCommand({
  meta: {
    description:
      "Loads the User Manager Replica and registers the current user as the super admin.",
  },
  args: {
    ...contextArgs,
  },
  async run({ args }) {
    await runCommand([
      "reside",
      "replica",
      "load",
      ...(args.context ? ["--context", args.context] : []),
      "ghcr.io/exeteres/reside/replicas/user-manager",
      "--auto-approve",
    ])

    await sleep(6_000)

    const { cluster, alpha, logOut } = await createJazzContextForCurrentContext(args.context)

    const { register } = await discoverRequirement(
      alpha.data,
      UserManagerContract,
      cluster.endpoint,
    )

    await register({})
    await logOut()

    logger.info({ success: true }, "successfully loaded User Manager and registered user account")
  },
})
