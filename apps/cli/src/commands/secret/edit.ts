import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { discoverRequirement } from "@contracts/alpha.v1"
import { getManagedSecretByName, SecretContract } from "@contracts/secret.v1"
import { Ajv2020 } from "ajv/dist/2020"
import { defineCommand } from "citty"
import { contextArgs, createJazzContextForCurrentContext, logger } from "../../shared"

function resolveEditorCommand(filePath: string): string[] {
  const rawCommand = process.env.VISUAL ?? process.env.EDITOR
  if (!rawCommand || !rawCommand.trim()) {
    return ["vi", filePath]
  }

  return ["sh", "-c", `${rawCommand} "${filePath}"`]
}

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
    const tempDir = await mkdtemp(join(tmpdir(), "reside-secret-"))
    const filePath = join(tempDir, "value.json")

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
      const originalSerialized = JSON.stringify(currentValue ?? null)

      const serialized = JSON.stringify(currentValue, null, 2) ?? "null"
      await writeFile(filePath, `${serialized}\n`, "utf-8")

      const editorCommand = resolveEditorCommand(filePath)

      const editorProcess = Bun.spawn(editorCommand, {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      })

      const exitCode = await editorProcess.exited
      if (exitCode !== 0) {
        throw new Error(`Editor "${editorCommand[0]!}" exited with code ${exitCode ?? "unknown"}.`)
      }

      const editedContent = await readFile(filePath, "utf-8")

      let parsedValue: unknown
      try {
        parsedValue = JSON.parse(editedContent)
      } catch (error) {
        throw new Error("Failed to parse edited secret value JSON", { cause: error })
      }

      const ajv = new Ajv2020({ strict: false })
      const validate = ajv.compile(loadedSecret.definition.schema)
      const isValid = validate(parsedValue)
      if (!isValid) {
        throw new Error(
          `Secret value does not conform to the defined schema: ${ajv.errorsText(validate.errors)}`,
        )
      }

      const updatedSerialized = JSON.stringify(parsedValue ?? null)

      if (updatedSerialized === originalSerialized) {
        logger.info(`secret "%s" value unchanged`, args.secretName)
        return
      }

      loadedSecret.value.$jazz.set("value", parsedValue)

      logger.info(`secret "%s" value updated`, args.secretName)
    } finally {
      try {
        await rm(tempDir, { recursive: true, force: true })
      } catch (err) {
        logger.error({ err }, `Failed to remove temporary directory: ${tempDir}`)
      }

      await logOut()
    }
  },
})
