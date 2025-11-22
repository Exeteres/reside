import { defineCommand } from "citty"
import { listPermissionsCommand } from "./list"
import { grantPermissionCommand } from "./grant"
import { clearPermissionCommand } from "./clear"

export const permissionCommand = defineCommand({
  subCommands: {
    list: listPermissionsCommand,
    grant: grantPermissionCommand,
    clear: clearPermissionCommand,
  },
})
