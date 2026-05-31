import Fastify, { type FastifyInstance } from "fastify"
import FastifyOtelInstrumentation from "@fastify/otel"
import type { CommonServices } from "./services"
import { registerGracefulShutdown } from "./utils"
import { logger } from "./logger"
import type { TracerProvider } from "@opentelemetry/api"

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
