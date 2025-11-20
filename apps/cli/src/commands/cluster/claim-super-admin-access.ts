import { defineCommand } from "citty"
import { contextArgs, createJazzContextForCurrentContext, logger } from "../../shared"

export const claimSuperAdminAccessCommand = defineCommand({
  args: {
    ...contextArgs,
  },
  async run({ args }) {
    const { alpha, logOut } = await createJazzContextForCurrentContext(args.context)

    logger.info("claiming super admin access...")

    await alpha.claimSuperAdminAccess({})
    await logOut()

    logger.info({ success: true }, "successfully claimed super admin access to the cluster")
  },
})
