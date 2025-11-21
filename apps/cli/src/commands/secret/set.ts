import { defineCommand } from "citty"
import { contextArgs, createJazzContextForCurrentContext, logger } from "../../shared"
import { getManagedSecretByName, SecretContract } from "@contracts/secret.v1"
import { discoverRequirement } from "@contracts/alpha.v1"
import { Ajv2020 } from "ajv/dist/2020"

export const setSecretValueCommand = defineCommand({
  meta: {
    description: "Sets the value of the specified secret in the cluster.",
  },
  args: {
    ...contextArgs,
    secretName: {
      type: "positional",
      description: "The name of the secret to set.",
      required: true,
    },
    secretValue: {
      type: "positional",
      description: "The value of the secret to set.",
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

    let parsedValue: unknown
    try {
      parsedValue = JSON.parse(args.secretValue)
    } catch (error) {
      throw new Error("Failed to parse secret value JSON", { cause: error })
    }

    if (!loadedSecret.definition.schema) {
      throw new Error(`Secret "${args.secretName}" is not initialized with a schema.`)
    }

    const ajv = new Ajv2020({ strict: false })
    const validate = ajv.compile(loadedSecret.definition.schema)
    const valid = validate(parsedValue)
    if (!valid) {
      throw new Error(
        `Secret value does not conform to the defined schema: ${ajv.errorsText(validate.errors)}`,
      )
    }

    if (loadedSecret.value.$jazz.owner.myRole() !== "writer") {
      throw new Error(
        `You do not have permission to set the value of the secret "${args.secretName}".`,
      )
    }

    loadedSecret.value.$jazz.set("value", parsedValue)

    logger.info(`secret "%s" value updated`, args.secretName)

    await logOut()
  },
})
