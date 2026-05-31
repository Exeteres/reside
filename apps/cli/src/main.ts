#!/usr/bin/env bun

import { defineCommand, runMain } from "citty"
import { bootstrapCommand, buildCommand, e2eCommand } from "./commands"

const main = defineCommand({
  meta: {
    name: "reside",
    description: "The CLI for managing Reside replicas and workflows",
  },
  subCommands: {
    bootstrap: bootstrapCommand,
    build: buildCommand,
    e2e: e2eCommand,
  },
})

runMain(main)
