import type { TracerProvider } from "@opentelemetry/api"
import { ConnectError, type Interceptor } from "@connectrpc/connect"
import { fastifyConnectPlugin } from "@connectrpc/connect-fastify"
import FastifyOtelInstrumentation from "@fastify/otel"
import Fastify, { type FastifyInstance } from "fastify"
import { logger } from "./logger"
import { registerGracefulShutdown } from "./utils"

const connectRpcErrorLoggingInterceptor: Interceptor = next => async request => {
  try {
    return await next(request)
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error
    }

    const errorObject = error instanceof Error ? error : new Error(String(error))

    logger.error(
      { error: errorObject },
      'connect rpc request failed service="%s" method="%s"',
      request.service.typeName,
      request.method.name,
    )

    throw error
  }
}

/**
 * Creates and configures a Fastify server instance with OpenTelemetry instrumentation.
 *
 * @param services The common services to be used by the server, including an optional tracer provider for OpenTelemetry.
 * @returns A configured Fastify server instance ready to be started.
 */
export async function createServer(services: { tracerProvider?: TracerProvider }) {
  const server = Fastify({
    disableRequestLogging: true,
  })

  const register = server.register.bind(server)
  server.register = ((plugin, opts) => {
    const pluginCandidate = plugin as unknown
    if (pluginCandidate === fastifyConnectPlugin && opts && typeof opts === "object") {
      const optionsWithInterceptors = opts as {
        interceptors?: Interceptor[]
      }

      if (!optionsWithInterceptors.interceptors?.includes(connectRpcErrorLoggingInterceptor)) {
        optionsWithInterceptors.interceptors = [
          ...(optionsWithInterceptors.interceptors ?? []),
          connectRpcErrorLoggingInterceptor,
        ]
      }
    }

    return register(plugin, opts)
  }) as typeof server.register

  const fastifyOtelInstrumentation = new FastifyOtelInstrumentation()
  if (services.tracerProvider) {
    fastifyOtelInstrumentation.setTracerProvider(services.tracerProvider)
  }

  await server.register(fastifyOtelInstrumentation.plugin())

  return server
}

/**
 * Starts the given Fastify server on the main replica port and registers a graceful shutdown handler.
 *
 * @param server The Fastify server instance to start.
 */
export async function startServer(server: FastifyInstance) {
  await server.listen({ host: "0.0.0.0", port: 8080 })

  logger.info("server started on port 8080")

  registerGracefulShutdown(async () => {
    logger.info("shutting down server")
    await server.close()
  })
}
