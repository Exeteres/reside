import { defineCommand } from "citty"
import { listDefaultPermissionsCommand } from "./list"
import { grantDefaultPermissionCommand } from "./grant"

export const defaultPermissionCommand = defineCommand({
  subCommands: {
    list: listDefaultPermissionsCommand,
    grant: grantDefaultPermissionCommand,
  },
})
