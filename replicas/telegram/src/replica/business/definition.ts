export type BusinessNotificationChannel = {
  name: string
  title: string
  description?: string
}

export type BusinessCommandParameter = {
  name: string
  title: string
  description?: string
  type: string
  required?: boolean
  rest?: boolean
}

export type BusinessCommand = {
  name: string
  title: string
  description?: string
  parameters: BusinessCommandParameter[]
  callbackEndpoint: string
  protected?: boolean
}

export function validateChannelDefinitions(channels: BusinessNotificationChannel[]): void {
  validateUniqueNames(
    channels.map(channel => channel.name),
    "channels",
  )
}

export function validateCommandDefinitions(commands: BusinessCommand[]): void {
  validateUniqueNames(
    commands.map(command => command.name),
    "commands",
  )

  for (const command of commands) {
    validateUniqueNames(
      command.parameters.map(parameter => parameter.name),
      `parameters of command "${command.name}"`,
    )

    validateCommandRestParameterShape(command.name, command.parameters)
    validateCallbackEndpoint(command.name, command.callbackEndpoint)
  }
}

export function validateUniqueNames(names: string[], fieldName: string): void {
  const knownNames = new Set<string>()

  for (const rawName of names) {
    const name = rawName.trim()
    if (name.length === 0) {
      throw new Error(`Field "${fieldName}" contains empty name`)
    }

    if (knownNames.has(name)) {
      throw new Error(`Field "${fieldName}" contains duplicate name "${name}"`)
    }

    knownNames.add(name)
  }
}

export function validateCommandRestParameterShape(
  commandName: string,
  parameters: BusinessCommandParameter[],
): void {
  const restIndexes: number[] = []

  for (let index = 0; index < parameters.length; index++) {
    if (parameters[index]?.rest === true) {
      restIndexes.push(index)
    }
  }

  if (restIndexes.length === 0) {
    return
  }

  if (restIndexes.length > 1) {
    throw new Error(`Command "${commandName}" must have at most one rest parameter`)
  }

  const restIndex = restIndexes[0]!
  if (restIndex !== parameters.length - 1) {
    throw new Error(`Command "${commandName}" must declare rest parameter as the last parameter`)
  }
}

export function validateCallbackEndpoint(commandName: string, callbackEndpoint: string): void {
  if (callbackEndpoint.trim().length > 0) {
    return
  }

  throw new Error(`Command "${commandName}" must provide non-empty callback_endpoint`)
}
