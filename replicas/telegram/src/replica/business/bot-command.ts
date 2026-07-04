import { CommandParameterType } from "@reside/api/interaction/definition.v1"
import { strings } from "../../locale"

type ParsedCommandParameter = {
  name: string
  title: string
  description?: string
  type: CommandParameterType
  required: boolean
  rest: boolean
}

export function parseLeadingMention(text: string): { username: string; prompt: string } | null {
  const match = text.match(/^@([A-Za-z0-9_]+)(\s+|$)/)
  if (!match) {
    return null
  }

  const username = match[1]
  if (!username) {
    return null
  }

  const matchedPrefix = match[0]
  if (!matchedPrefix) {
    return null
  }

  return {
    username,
    prompt: text.slice(matchedPrefix.length),
  }
}

export function resolveNlsMessageThreadId(message: {
  message_id: number
  message_thread_id?: number
  reply_to_message?: {
    message_thread_id?: number
  }
}): number {
  const directThreadId = message.message_thread_id
  if (typeof directThreadId === "number" && Number.isInteger(directThreadId)) {
    return directThreadId
  }

  const replyThreadId = message.reply_to_message?.message_thread_id
  if (typeof replyThreadId === "number" && Number.isInteger(replyThreadId)) {
    return replyThreadId
  }

  return message.message_id
}

export function parseCommandInvocation(text: string): {
  name: string
  parameters: string[]
} | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith("/")) {
    return null
  }

  const parts = trimmed.slice(1).split(/\s+/).filter(Boolean)
  const [rawCommand, ...args] = parts
  if (!rawCommand) {
    return null
  }

  const commandName = rawCommand.split("@")[0]?.trim()
  if (!commandName) {
    return null
  }

  return {
    name: commandName,
    parameters: args,
  }
}

export function parseStoredCommandParameters(raw: unknown): ParsedCommandParameter[] {
  if (!Array.isArray(raw)) {
    return []
  }

  return raw
    .filter(
      (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null,
    )
    .map(entry => ({
      name: typeof entry.name === "string" ? entry.name : "",
      title: typeof entry.title === "string" ? entry.title : "",
      description: typeof entry.description === "string" ? entry.description : undefined,
      type:
        typeof entry.type === "number" &&
        (entry.type === CommandParameterType.STRING ||
          entry.type === CommandParameterType.INTEGER ||
          entry.type === CommandParameterType.BOOLEAN ||
          entry.type === CommandParameterType.USER)
          ? entry.type
          : CommandParameterType.STRING,
      required: entry.required === true,
      rest: entry.rest === true,
    }))
    .filter(parameter => parameter.name.length > 0 && parameter.title.length > 0)
}

export function parseCommandParameters(
  rawParameters: unknown,
  values: string[],
): Record<string, unknown> {
  const definitions = parseStoredCommandParameters(rawParameters)
  assertRestParameterShape(definitions)

  const params: Record<string, unknown> = {}
  let valueIndex = 0

  for (const definition of definitions) {
    if (!definition) {
      continue
    }

    if (definition.rest === true) {
      const restValue = values.slice(valueIndex).join(" ")
      if (restValue.length > 0) {
        params[definition.name] = parseCommandParameterValue(definition, restValue)
      } else if (definition.required === true) {
        throw new Error(strings.worker.bot.parameterRequired(definition.name))
      }

      break
    }

    const value = values[valueIndex]
    if (value === undefined) {
      if (definition.required === true) {
        throw new Error(strings.worker.bot.parameterRequired(definition.name))
      }

      valueIndex++
      continue
    }

    params[definition.name] = parseCommandParameterValue(definition, value)
    valueIndex++
  }

  return params
}

function parseCommandParameterValue(definition: ParsedCommandParameter, value: string): unknown {
  if (definition.type === CommandParameterType.INTEGER) {
    const parsedValue = Number(value)
    if (!Number.isInteger(parsedValue)) {
      throw new Error(strings.worker.bot.parameterMustBeInteger(definition.name))
    }

    return parsedValue
  }

  if (definition.type === CommandParameterType.BOOLEAN) {
    if (value === "true" || value === "1") {
      return true
    }

    if (value === "false" || value === "0") {
      return false
    }

    throw new Error(strings.worker.bot.parameterMustBeBoolean(definition.name))
  }

  return value
}

function assertRestParameterShape(definitions: ParsedCommandParameter[]): void {
  const restIndexes: number[] = []

  for (let index = 0; index < definitions.length; index++) {
    if (definitions[index]?.rest === true) {
      restIndexes.push(index)
    }
  }

  if (
    restIndexes.length <= 1 &&
    (restIndexes.length === 0 || restIndexes[0] === definitions.length - 1)
  ) {
    return
  }

  throw new Error(strings.worker.bot.commandExecutionFailed)
}
