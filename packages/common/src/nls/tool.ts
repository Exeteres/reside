export type ToolResultType = "success" | "failure" | "rejected" | "denied"

export type ToolBinaryResult = {
  data: string
  mimeType: string
  type: string
  description?: string
}

export type ToolResultObject = {
  textResultForLlm: string
  binaryResultsForLlm?: ToolBinaryResult[]
  resultType: ToolResultType
  error?: string
  sessionLog?: string
  toolTelemetry?: Record<string, unknown>
}

export type ToolResult = string | ToolResultObject

export type ToolInvocation = {
  sessionId: string
  toolCallId: string
  toolName: string
  arguments: unknown
  traceparent?: string
  tracestate?: string
}

export type ToolHandler<TArgs = unknown> = {
  bivarianceHack(args: TArgs, invocation: ToolInvocation): Promise<unknown> | unknown
}["bivarianceHack"]

export type ZodSchema<T = unknown> = {
  _output: T
  toJSONSchema?: () => Record<string, unknown>
}

export type Tool<TArgs = unknown> = {
  name: string
  description?: string
  parameters?: ZodSchema<TArgs> | Record<string, unknown>
  handler: ToolHandler<TArgs>
  overridesBuiltInTool?: boolean
  skipPermission?: boolean
}

export type SessionConfig = {
  tools?: Tool[]
}

const NLS_TOOL_NAME_PREFIX = "reside_"

export function defineTool<T = unknown>(
  name: string,
  config: {
    description?: string
    parameters?: ZodSchema<T> | Record<string, unknown>
    handler: ToolHandler<T>
    overridesBuiltInTool?: boolean
    skipPermission?: boolean
  },
): Tool<T> {
  if (!name.startsWith(NLS_TOOL_NAME_PREFIX)) {
    throw new Error(`NLS tool name "${name}" must start with "${NLS_TOOL_NAME_PREFIX}"`)
  }

  return { name, ...config }
}
