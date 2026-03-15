import type { CommandInvocation } from "@reside/api/interaction/command.v1"
import { upsertMemo } from "@temporalio/workflow"
import type { Simplify } from "type-fest"

export type CommandDefinition<
  TParameters extends Record<string, CommandDefinitionParameter> = Record<
    string,
    CommandDefinitionParameter
  >,
> = {
  /**
   * The unique name of the command to be used in the command palette and for invocation.
   */
  name: string
  /**
   * The human-readable title of the command to be displayed to the user.
   */
  title: string

  /**
   * The description of the command to be displayed to the user.
   */
  description?: string

  /**
   * The parameters of the command.
   */
  params?: TParameters

  /**
   * Whether invocation of this command requires explicit permission checks.
   */
  protected?: boolean
}

export type ParameterType = "string" | "integer" | "boolean"

export type CommandDefinitionParameter<
  TType extends ParameterType = ParameterType,
  TRequired extends boolean = boolean,
> = {
  /**
   * The human-readable title of the parameter to be displayed to the user.
   */
  title: string

  /**
   * The description of the parameter to be displayed to the user.
   */
  description?: string

  /**
   * The type of the parameter.
   */
  type: TType

  /**
   * Whether the parameter is required or optional.
   */
  required?: TRequired

  /**
   * Whether the parameter is rest parameter that captures all remaining input as a single string.
   */
  rest?: boolean
}

export type ParameterValue<TType extends ParameterType> = TType extends "string"
  ? string
  : TType extends "integer"
    ? number
    : TType extends "boolean"
      ? boolean
      : never

export type CommandParameters<TParameters extends Record<string, CommandDefinitionParameter>> = {
  [K in keyof TParameters]: TParameters[K]["required"] extends true
    ? ParameterValue<TParameters[K]["type"]>
    : ParameterValue<TParameters[K]["type"]> | undefined
}

export function defineCommand<
  TParameters extends Record<string, CommandDefinitionParameter> = Record<string, never>,
>(definition: CommandDefinition<TParameters>): CommandDefinition<TParameters> {
  return definition
}

export type CommandHandlerContext<TDefinition extends CommandDefinition> = {
  /**
   * The definition of the command being handled.
   */
  definition: TDefinition

  /**
   * The underlying command invocation that triggered the command handler workflow.
   */
  invocation: CommandInvocation

  /**
   * The parsed parameters from the command invocation, validated against the command definition.
   */
  params: Simplify<CommandParameters<NonNullable<TDefinition["params"]>>>
}

export type CommandHandler<TDefinition extends CommandDefinition> = (
  context: CommandHandlerContext<TDefinition>,
) => Promise<void> | void

export type CommandHandlerDefinition<TDefinition extends CommandDefinition> = {
  /**
   * The definition of the command to handle.
   */
  command: TDefinition

  /**
   * The handler function to execute when the command is invoked.
   */
  handler: CommandHandler<TDefinition>
}

export function defineCommandHandler<TDefinition extends CommandDefinition>(
  definition: CommandHandlerDefinition<TDefinition>,
): CommandHandlerDefinition<TDefinition> {
  return definition
}

export function createCommandHandlerWorkflow(definitions: CommandHandlerDefinition<any>[]) {
  return async function handleCommandWorkflow(invocation: CommandInvocation) {
    if (!invocation.command) {
      throw new Error("Invalid command invocation: missing command")
    }

    const definition = definitions.find(def => def.command.name === invocation.command!.name)
    if (!definition) {
      throw new Error(`No handler found for command: ${invocation.command.name}`)
    }

    const params = parseCommandParameters(definition.command.params, invocation.parameters ?? {})

    upsertMemo({
      interactionContextId: invocation.context?.id,
    })

    await definition.handler({
      definition: definition.command,
      invocation,
      params,
    })
  }
}

function parseCommandParameters(
  paramDefinitions: Record<string, CommandDefinitionParameter> | undefined,
  parameters: Record<string, unknown>,
): Record<string, any> {
  if (!paramDefinitions) {
    return {}
  }

  const params: Record<string, unknown> = {}

  for (const [key, definition] of Object.entries(paramDefinitions)) {
    const value = parameters[key]

    if (value === undefined || value === null) {
      if (definition.required) {
        throw new Error(`Missing required parameter: ${key}`)
      } else {
        params[key] = undefined
        continue
      }
    }

    switch (definition.type) {
      case "string":
        if (typeof value !== "string") {
          throw new Error(`Invalid type for parameter ${key}: expected string`)
        }
        params[key] = value
        break
      case "integer":
        if (typeof value !== "number" || !Number.isInteger(value)) {
          throw new Error(`Invalid type for parameter ${key}: expected integer`)
        }
        params[key] = value
        break
      case "boolean":
        if (typeof value !== "boolean") {
          throw new Error(`Invalid type for parameter ${key}: expected boolean`)
        }
        params[key] = value
        break
      default:
        throw new Error(`Unsupported parameter type for ${key}: ${definition.type}`)
    }
  }

  return params
}
