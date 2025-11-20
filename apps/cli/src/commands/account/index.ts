import { defineCommand } from "citty"
import { createAccountCommand } from "./create"

export const accountCommand = defineCommand({
  subCommands: {
    create: createAccountCommand,
  },
})
