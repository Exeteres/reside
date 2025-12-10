import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Ajv2020 } from "ajv/dist/2020"
import { mock } from "mock-json-schema"
import * as YAML from "yaml"

function resolveEditorCommand(filePath: string): string[] {
  const rawCommand = process.env.VISUAL ?? process.env.EDITOR
  if (!rawCommand || !rawCommand.trim()) {
    return ["vi", filePath]
  }

  return ["sh", "-c", `${rawCommand} "${filePath}"`]
}

export type EditorOptions<T> = {
  /**
   * Prefix for the temporary directory used to store the edited file.
   */
  tempDirPrefix: string

  /**
   * File name within the temporary directory.
   */
  fileName: string

  /**
   * Initial value to serialize into the editor file.
   */
  initialValue?: T

  /**
   * Optional JSON schema to validate the edited value against.
   */
  schema?: Record<string, unknown>
}

export type EditorResult<T> = {
  value: T
  changed: boolean
}

export async function editYamlWithSchema<T>(options: EditorOptions<T>): Promise<EditorResult<T>> {
  const { tempDirPrefix, fileName, initialValue, schema } = options

  const tempDir = await mkdtemp(join(tmpdir(), `${tempDirPrefix}-`))
  const filePath = join(tempDir, fileName)

  const originalSerialized = JSON.stringify(initialValue ?? null)
  const initialDocumentValue = resolveInitialDocumentValue(initialValue, schema)
  let nextContent = serializeDocument(initialDocumentValue)

  const ajv = schema ? new Ajv2020({ strict: false, allErrors: true }) : undefined
  const validate = schema ? ajv!.compile(schema) : undefined

  let parsedValue: unknown

  try {
    // re-open editor until YAML parse and schema validation succeed
    // eslint-disable-next-line no-constant-condition
    while (true) {
      await writeFile(filePath, ensureTrailingNewline(nextContent), "utf-8")

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
      const sanitizedContent = stripErrorCommentBlock(editedContent)

      try {
        parsedValue = YAML.parse(sanitizedContent)
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to parse edited YAML"
        nextContent = buildContentWithError(message, sanitizedContent)
        continue
      }

      if (validate && !validate(parsedValue)) {
        const message =
          validate.errors && validate.errors.length > 0
            ? ajv!.errorsText(validate.errors, { separator: "\n" })
            : "Edited value does not conform to the schema"

        nextContent = buildContentWithError(message, sanitizedContent)
        continue
      }

      break
    }

    const updatedSerialized = JSON.stringify(parsedValue ?? null)

    return {
      value: (parsedValue ?? null) as T,
      changed: updatedSerialized !== originalSerialized,
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

function resolveInitialDocumentValue<T>(
  initialValue: T | undefined,
  schema?: Record<string, unknown>,
) {
  const currentValue = isPlainObject(initialValue) ? initialValue : {} // always merge an object overlay

  if (!schema) {
    return currentValue
  }

  const template = mock(schema)

  return mergeTemplateWithValue(template, currentValue)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function mergeTemplateWithValue(template: unknown, value: unknown): unknown {
  if (isPlainObject(template) && isPlainObject(value)) {
    const templateRecord = template as Record<string, unknown>
    const valueRecord = value as Record<string, unknown>
    const result: Record<string, unknown> = { ...templateRecord }

    for (const [key, child] of Object.entries(valueRecord)) {
      if (child === undefined) {
        continue
      }

      result[key] = mergeTemplateWithValue(templateRecord[key], child)
    }

    return result
  }

  if (value === undefined) {
    return template
  }

  return value
}

function serializeDocument(value: unknown): string {
  return YAML.stringify(value ?? null, null, 2) ?? "null"
}

function ensureTrailingNewline(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`
}

function buildContentWithError(message: string, content: string): string {
  const commentBlock = formatErrorCommentBlock(message)
  const trimmedContent = stripLeadingNewlines(content)

  if (!trimmedContent) {
    return commentBlock
  }

  return `${commentBlock}\n\n${trimmedContent}`
}

function formatErrorCommentBlock(message: string): string {
  const lines = message.split(/\r?\n/)
  return lines.map(line => `# ERROR: ${line}`).join("\n")
}

function stripLeadingNewlines(content: string): string {
  let result = content
  while (result.startsWith("\n")) {
    result = result.slice(1)
  }
  return result
}

function stripErrorCommentBlock(content: string): string {
  if (!content.startsWith("# ERROR:")) {
    return content
  }

  const lines = content.split(/\r?\n/)
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ""
    if (!line.startsWith("# ERROR:")) {
      break
    }

    index += 1
  }

  if (index === 0) {
    return content
  }

  if (index < lines.length) {
    const separatorLine = lines[index] ?? ""
    if (separatorLine.trim() === "") {
      index += 1
    }
  }

  const remainderLines = lines.slice(index)
  const remainder = remainderLines.join("\n")

  if (!remainder) {
    return ""
  }

  return content.endsWith("\n") ? `${remainder}\n` : remainder
}
