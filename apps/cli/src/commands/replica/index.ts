import { defineCommand } from "citty"
import { loadReplicaCommand } from "./load"
import { listReplicasCommand } from "./list"
import { enableReplicaCommand } from "./enable"
import { disableReplicaCommand } from "./disable"

export const replicaCommand = defineCommand({
  subCommands: {
    load: loadReplicaCommand,
    list: listReplicasCommand,
    enable: enableReplicaCommand,
    disable: disableReplicaCommand,
  },
})
