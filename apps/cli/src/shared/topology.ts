import { readFile } from "node:fs/promises"
import { input } from "@inquirer/prompts"
import { topology as packageTopology, type Replica as TopologyReplica } from "@reside/topology"

export type { TopologyReplica }
export type ResideTopology = TopologyReplica[]
export type MissingVariablePrompt = (variableName: string) => Promise<string>

const environmentReferencePattern = /\$(?:\{([A-Z0-9_]+)\}|([A-Z0-9_]+))/g
const fileReferencePattern = /^\$file:([A-Z0-9_]+)$/

/**
 * Loads and validates a topology file.
 *
 * The topology package already provides replicas in dependency order.
 * The optional path argument is ignored for compatibility with existing callers.
 *
 * @param _topologyPath The deprecated topology path override.
 * @returns The validated topology and its resolved path.
 */
export async function loadTopology(_topologyPath?: string): Promise<{
  topology: ResideTopology
  topologyPath: string
}> {
  return {
    topology: packageTopology,
    topologyPath: "@reside/topology",
  }
}

/**
 * Replaces dots in Kubernetes endpoint names with dashes.
 *
 * @param endpointName The raw endpoint name.
 * @returns The sanitized service name.
 */
export function sanitizeEndpointName(endpointName: string): string {
  return endpointName.replaceAll(".", "-")
}

/**
 * Resolves the requested replicas to a dependency-complete topological order.
 *
 * When no explicit replicas are requested, all topology replicas are selected.
 *
 * @param topology The loaded topology.
 * @param requestedReplicas The replica names requested by the user.
 * @returns The selected replicas in dependency order.
 */
export function resolveReplicaSelection(
  topology: ResideTopology,
  requestedReplicas: string[],
  options?: {
    includeDependencies?: boolean
  },
): TopologyReplica[] {
  const replicaMap = new Map<string, TopologyReplica>()

  for (const replica of topology) {
    replicaMap.set(replica.name, replica)
  }

  const roots =
    requestedReplicas.length > 0 ? requestedReplicas : topology.map(replica => replica.name)
  const included = new Set<string>()
  const includeDependencies = options?.includeDependencies ?? true

  function visit(replicaName: string): void {
    const replica = replicaMap.get(replicaName)
    if (!replica) {
      throw new Error(`Replica "${replicaName}" is not defined in topology`)
    }

    if (included.has(replicaName)) {
      return
    }

    if (includeDependencies) {
      for (const dependencyName of Object.values(replica.dependencies.replicas).map(
        dependency => dependency.name,
      )) {
        visit(dependencyName)
      }
    }

    included.add(replicaName)
  }

  for (const replicaName of roots) {
    visit(replicaName)
  }

  return topology.filter(replica => included.has(replica.name))
}

/**
 * Reads repeated string arguments produced by the CLI parser.
 *
 * It supports repeated flags and comma-separated values.
 *
 * @param args The parsed command arguments object.
 * @param name The argument name.
 * @returns The normalized string array.
 */
export function readStringArrayArgument(args: object, name: string): string[] {
  const rawValue = Reflect.get(args, name)

  if (typeof rawValue === "string") {
    return splitArgumentValue(rawValue)
  }

  if (!Array.isArray(rawValue)) {
    return []
  }

  const values: string[] = []

  for (const value of rawValue) {
    if (typeof value !== "string") {
      continue
    }

    values.push(...splitArgumentValue(value))
  }

  return values
}

function splitArgumentValue(value: string): string[] {
  return value
    .split(",")
    .map(item => item.trim())
    .filter(item => item.length > 0)
}

/**
 * Resolves environment variable placeholders in a string.
 *
 * Missing variables are requested interactively and cached through the provided
 * resolver callback.
 *
 * @param template The value template.
 * @param resolveVariable Resolves a single variable name to a concrete value.
 * @returns The substituted value.
 */
export async function substituteEnvironmentReferences(
  template: string,
  resolveVariable: (name: string) => Promise<string>,
): Promise<string> {
  const fileReferenceMatch = template.match(fileReferencePattern)
  if (fileReferenceMatch) {
    const variableName = fileReferenceMatch[1]
    if (!variableName) {
      return template
    }

    const filePath = await resolveVariable(variableName)
    if (filePath.trim().length === 0) {
      throw new Error(`Environment variable "${variableName}" resolved to an empty file path`)
    }

    try {
      return await readFile(filePath, "utf8")
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(
        `Failed to read file from environment reference "$file:${variableName}" at path "${filePath}": ${message}`,
      )
    }
  }

  const matches = [...template.matchAll(environmentReferencePattern)]

  if (matches.length === 0) {
    return template
  }

  let resolvedValue = template

  for (const match of matches) {
    const variableName = match[1] ?? match[2]
    if (!variableName) {
      continue
    }

    const variableValue = await resolveVariable(variableName)
    resolvedValue = resolvedValue.replace(match[0], variableValue)
  }

  return resolvedValue
}

/**
 * Resolves all key/value pairs for a secret or config map payload.
 *
 * @param data The raw template values.
 * @param resolveVariable Resolves a single variable name to a concrete value.
 * @returns The substituted key/value mapping.
 */
export async function resolveDataValues(
  data: Record<string, string>,
  resolveVariable: (name: string) => Promise<string>,
): Promise<Record<string, string>> {
  const resolvedData: Record<string, string> = {}

  for (const [key, value] of Object.entries(data)) {
    resolvedData[key] = await substituteEnvironmentReferences(value, resolveVariable)
  }

  return resolvedData
}

/**
 * Resolves an environment variable or asks the user for its value.
 *
 * @param variableName The environment variable name.
 * @param promptMissingVariable The optional interactive prompt implementation.
 * @returns The resolved value.
 */
export async function promptEnvironmentVariable(
  variableName: string,
  promptMissingVariable?: MissingVariablePrompt,
): Promise<string> {
  const existingValue = process.env[variableName]
  if (existingValue) {
    return existingValue
  }

  if (promptMissingVariable) {
    return await promptMissingVariable(variableName)
  }

  return await input({
    message: `Enter value for ${variableName}`,
    validate: value => (value.trim().length > 0 ? true : `${variableName} cannot be empty`),
  })
}
