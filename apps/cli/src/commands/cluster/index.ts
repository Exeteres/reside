import { defineCommand } from "citty"
import { clusterInfoCommand } from "./info"
import { claimSuperAdminAccessCommand } from "./claim-super-admin-access"
import { bootstrapClusterCommand } from "./bootstrap"
import { clusterLogsCommand } from "./logs"
import { loadUserManagerCommand } from "./load-user-manager"

export const clusterCommand = defineCommand({
  subCommands: {
    info: clusterInfoCommand,
    "claim-super-admin-access": claimSuperAdminAccessCommand,
    "load-user-manager": loadUserManagerCommand,
    bootstrap: bootstrapClusterCommand,
    logs: clusterLogsCommand,
  },
})
