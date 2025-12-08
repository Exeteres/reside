import { defineCommand } from "citty"
import { editSecretValueCommand } from "./edit"
import { getSecretValueCommand } from "./get"
import { listSecretsCommand } from "./list"
import { setSecretValueCommand } from "./set"

export const secretCommand = defineCommand({
  subCommands: {
    list: listSecretsCommand,
    set: setSecretValueCommand,
    get: getSecretValueCommand,
    edit: editSecretValueCommand,
  },
})
