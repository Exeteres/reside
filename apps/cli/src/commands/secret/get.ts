import { SecretContract } from "@contracts/secret.v1"
import { contextArgs, createJazzContextForCurrentContext } from "../../shared"
import { defineCommand } from "citty"
import { getManagedSecretByName } from "@contracts/secret.v1"
import { discoverRequirement } from "@contracts/alpha.v1"

export const getSecretValueCommand = defineCommand({
  meta: {
    description: "Reads the value of the specified secret in the cluster.",
  },
  args: {
    ...contextArgs,
    secretName: {
      type: "positional",
      description: "The name of the secret to get.",
      required: true,
    },
  },

  async run({ args }) {
    const { alpha, logOut } = await createJazzContextForCurrentContext(args.context)
    const secretManager = await discoverRequirement(alpha.data, SecretContract)

    const secret = await getManagedSecretByName(secretManager.data, args.secretName)
    if (!secret) {
      throw new Error(`Secret with name "${args.secretName}" not found.`)
    }

    const loadedSecret = await secret.$jazz.ensureLoaded({
      resolve: {
        definition: true,
        value: true,
      },
    })

    console.log(JSON.stringify(loadedSecret.value.value, null, 2))
    await logOut()
  },
})
