import { defineCommand } from "citty"
import { listSecretsCommand } from "./list"
import { setSecretValueCommand } from "./set"
import { getSecretValueCommand } from "./get"

export const secretCommand = defineCommand({
  subCommands: {
    list: listSecretsCommand,
    set: setSecretValueCommand,
    get: getSecretValueCommand,
  },
})
