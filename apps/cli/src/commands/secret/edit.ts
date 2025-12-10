import { discoverRequirement } from "@contracts/alpha.v1"
import { getManagedSecretByName, SecretContract } from "@contracts/secret.v1"
import { defineCommand } from "citty"
import {
  contextArgs,
  createJazzContextForCurrentContext,
  editYamlWithSchema,
  logger,
} from "../../shared"

export const editSecretValueCommand = defineCommand({
  meta: {
    description:
      "Edits the value of the specified secret in the cluster via an interactive editor.",
  },
  args: {
    ...contextArgs,
    secretName: {
      type: "positional",
      description: "The name of the secret to edit.",
      required: true,
    },
  },

  async run({ args }) {
    const { alpha, logOut } = await createJazzContextForCurrentContext(args.context)
    try {
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

      if (!loadedSecret.definition.schema) {
        throw new Error(`Secret "${args.secretName}" is not initialized with a schema.`)
      }

      if (loadedSecret.value.$jazz.owner.myRole() !== "writer") {
        throw new Error(
          `You do not have permission to set the value of the secret "${args.secretName}".`,
        )
      }

      const currentValue = loadedSecret.value.value ?? null

      const { value: updatedValue, changed } = await editYamlWithSchema({
        tempDirPrefix: "reside-secret",
        fileName: "value.yaml",
        initialValue: currentValue,
        schema: loadedSecret.definition.schema,
      })

      if (!changed) {
        logger.info(`secret "%s" value unchanged`, args.secretName)
        return
      }

      loadedSecret.value.$jazz.set("value", updatedValue)

      logger.info(`secret "%s" value updated`, args.secretName)
    } finally {
      await logOut()
    }
  },
})
