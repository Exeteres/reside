import type { Server as HttpServer, IncomingMessage, ServerResponse } from "node:http"
import type { AnySchema } from "@modelcontextprotocol/sdk/server/zod-compat.js"
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js"
import type {
  CallToolResult,
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js"
import type { Tool, ToolResultObject } from "./tool"
import { randomUUID } from "node:crypto"
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { z } from "zod"
import { logger } from "../logger"

const MCP_PATH = "/mcp"
const MCP_HOST = "127.0.0.1"

export type NlsMcpToolServer = {
  name: string
  url: string
  token: string
  toolNames: string[]
  stop: () => Promise<void>
}

type McpRequest = {
  body: unknown
  header: (name: string) => string | undefined
}

type McpResponse = {
  headersSent: boolean
  status: (code: number) => McpResponse
  json: (body: unknown) => void
  set: (field: string, value: string) => McpResponse
  send: (body: string) => void
  on: (event: "close", listener: () => void) => McpResponse
}

type McpNext = () => void

export async function startNlsMcpToolServer({
  sessionId,
  tools,
}: {
  sessionId: string
  tools: Tool[]
}): Promise<NlsMcpToolServer> {
  const token = randomUUID()
  const app = createMcpExpressApp({ host: MCP_HOST })

  app.use((request: McpRequest, response: McpResponse, next: McpNext) => {
    const authorization = request.header("authorization") ?? ""
    if (authorization === `Bearer ${token}`) {
      next()
      return
    }

    response.status(401).json({ error: "unauthorized" })
  })

  app.post(MCP_PATH, async (request: McpRequest, response: McpResponse) => {
    const server = createToolServer(sessionId, tools)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })

    const close = () => {
      void transport.close().catch(error => {
        logger.warn({ error: normalizeError(error) }, "nls mcp transport close failed")
      })
      void server.close().catch(error => {
        logger.warn({ error: normalizeError(error) }, "nls mcp server close failed")
      })
    }

    try {
      await server.connect(transport)
      await transport.handleRequest(
        request as unknown as IncomingMessage & { auth?: never },
        response as unknown as ServerResponse,
        request.body,
      )
      response.on("close", close)
    } catch (error) {
      logger.warn({ error: normalizeError(error) }, "nls mcp request failed")
      if (!response.headersSent) {
        response.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
          },
          id: null,
        })
      }
      close()
    }
  })

  app.all(MCP_PATH, (_request: McpRequest, response: McpResponse) => {
    response.status(405).set("Allow", "POST").send("Method Not Allowed")
  })

  const httpServer = await listen(app, MCP_HOST)
  const address = httpServer.address()
  if (!address || typeof address === "string") {
    await closeHttpServer(httpServer)
    throw new Error("NLS MCP server did not bind to a TCP port")
  }

  return {
    name: "reside_nls",
    url: `http://${MCP_HOST}:${address.port}${MCP_PATH}`,
    token,
    toolNames: tools.map(tool => tool.name),
    stop: async () => {
      await closeHttpServer(httpServer)
    },
  }
}

function createToolServer(sessionId: string, tools: Tool[]): McpServer {
  const server = new McpServer(
    {
      name: "reside-nls-tools",
      version: "1.0.0",
    },
    {
      instructions:
        "Use these tools only for ReSide replica operations. Treat returned IDs, ECIDs, RHIDs, and credentials as sensitive operational data.",
    },
  )

  for (const tool of tools) {
    const inputSchema = getMcpInputSchema(tool.parameters)

    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema,
        annotations: {
          destructiveHint: true,
          openWorldHint: true,
        },
      },
      async (args: unknown, extra: RequestHandlerExtra<ServerRequest, ServerNotification>) => {
        const toolCallId = String(extra.requestId)

        try {
          const result = await tool.handler(args, {
            sessionId,
            toolCallId,
            toolName: tool.name,
            arguments: args,
          })

          return toCallToolResult(result)
        } catch (error) {
          const errorMessage = describeToolError(error)
          logger.warn(
            { error: normalizeError(error) },
            'nls tool execution failed session_id="%s" tool_name="%s" tool_call_id="%s"',
            sessionId,
            tool.name,
            toolCallId,
          )

          const errorResult: CallToolResult = {
            content: [
              {
                type: "text",
                text: `Tool "${tool.name}" failed: ${errorMessage}`,
              },
            ],
            isError: true,
            structuredContent: {
              errorMessage,
              toolName: tool.name,
            },
          }

          return errorResult
        }
      },
    )
  }

  return server
}

function getMcpInputSchema(parameters: unknown): AnySchema {
  if (isMcpSchema(parameters)) {
    return parameters
  }

  return z.object({})
}

function isMcpSchema(value: unknown): value is AnySchema {
  if (!value || typeof value !== "object") {
    return false
  }

  return "safeParse" in value || "_zod" in value || "_def" in value
}

function toCallToolResult(result: unknown): CallToolResult {
  if (typeof result === "string") {
    return {
      content: [{ type: "text", text: result }],
    }
  }

  if (isToolResultObject(result)) {
    return {
      content: [{ type: "text", text: result.textResultForLlm }],
      isError: result.resultType !== "success",
      structuredContent: toStructuredContent(result.toolTelemetry),
    }
  }

  const text = stringifyToolResult(result)
  const structuredContent = toStructuredContent(result)

  return structuredContent
    ? {
        content: [{ type: "text", text }],
        structuredContent,
      }
    : {
        content: [{ type: "text", text }],
      }
}

function isToolResultObject(value: unknown): value is ToolResultObject {
  if (!value || typeof value !== "object") {
    return false
  }

  const candidate = value as Partial<ToolResultObject>
  return typeof candidate.textResultForLlm === "string" && typeof candidate.resultType === "string"
}

function toStructuredContent(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined
  }

  return value as Record<string, unknown>
}

function stringifyToolResult(result: unknown): string {
  if (result === undefined) {
    return ""
  }

  if (typeof result === "string") {
    return result
  }

  try {
    return JSON.stringify(result)
  } catch {
    return String(result)
  }
}

function describeToolError(error: unknown): string {
  const message = getErrorMessage(error)
  const status = getErrorStatus(error)
  const responseStatus = getResponseStatus(error)
  const responseMessage = getResponseMessage(error)
  const parts = [message]

  if (status.length > 0) {
    parts.push(`status=${status}`)
  }

  if (responseStatus.length > 0) {
    parts.push(`response_status=${responseStatus}`)
  }

  if (responseMessage.length > 0) {
    parts.push(`response_message=${responseMessage}`)
  }

  const description = parts.filter(Boolean).join("; ")
  return truncateOneLine(description.length > 0 ? description : "unknown error", 1500)
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? "")
  }

  return String(error)
}

function getErrorStatus(error: unknown): string {
  if (!error || typeof error !== "object" || !("status" in error)) {
    return ""
  }

  return String((error as { status?: unknown }).status ?? "")
}

function getResponseStatus(error: unknown): string {
  const response = getErrorResponse(error)
  if (!response || typeof response !== "object" || !("status" in response)) {
    return ""
  }

  return String((response as { status?: unknown }).status ?? "")
}

function getResponseMessage(error: unknown): string {
  const response = getErrorResponse(error)
  if (!response || typeof response !== "object" || !("data" in response)) {
    return ""
  }

  return extractResponseMessage((response as { data?: unknown }).data)
}

function getErrorResponse(error: unknown): unknown {
  if (!error || typeof error !== "object" || !("response" in error)) {
    return undefined
  }

  return (error as { response?: unknown }).response
}

function extractResponseMessage(value: unknown): string {
  if (typeof value === "string") {
    return value
  }

  if (!value || typeof value !== "object") {
    return ""
  }

  if ("message" in value) {
    return String((value as { message?: unknown }).message ?? "")
  }

  if ("error" in value) {
    return String((value as { error?: unknown }).error ?? "")
  }

  try {
    return JSON.stringify(value)
  } catch {
    return ""
  }
}

function truncateOneLine(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, maxLength)}...`
}

async function listen(
  app: ReturnType<typeof createMcpExpressApp>,
  host: string,
): Promise<HttpServer> {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, host, () => {
      resolve(server)
    })
    server.once("error", reject)
  })
}

async function closeHttpServer(server: HttpServer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close(error => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error
  }

  return new Error(String(error))
}
