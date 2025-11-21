#! /usr/bin/env bun

import { defineCommand, runMain } from "citty"
import {
  accountCommand,
  buildCommand,
  clusterCommand,
  devCommand,
  identityCommand,
  permissionCommand,
  replicaCommand,
  secretCommand,
} from "./commands"

process.env.RESIDE_ACCESS_CONTEXT ??= "external"

const main = defineCommand({
  meta: {
    name: "reside",
    description: "The CLI for managing the Reside platform",
  },
  subCommands: {
    build: buildCommand,
    dev: devCommand,
    cluster: clusterCommand,
    account: accountCommand,
    identity: identityCommand,
    replica: replicaCommand,
    permission: permissionCommand,
    secret: secretCommand,
  },
})

runMain(main)
