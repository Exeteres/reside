import { defineCommand } from "citty"
import { listPermissionsCommand } from "./list"
import { grantPermissionCommand } from "./grant"

export const permissionCommand = defineCommand({
  subCommands: {
    list: listPermissionsCommand,
    grant: grantPermissionCommand,
  },
})
