import { defineCommand } from "citty"
import { disableReplicaCommand } from "./disable"
import { enableReplicaCommand } from "./enable"
import { listReplicasCommand } from "./list"
import { loadReplicaCommand } from "./load"
import { updateReplicaPlacementGroupCommand } from "./update-placement-group"

export const replicaCommand = defineCommand({
  subCommands: {
    load: loadReplicaCommand,
    list: listReplicasCommand,
    enable: enableReplicaCommand,
    disable: disableReplicaCommand,
    "update-placement-group": updateReplicaPlacementGroupCommand,
  },
})
