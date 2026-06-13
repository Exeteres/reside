import { Metadata } from "@grpc/grpc-js"
import { type TracerProvider, trace } from "@opentelemetry/api"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc"
import { PinoInstrumentation } from "@opentelemetry/instrumentation-pino"
import { resourceFromAttributes } from "@opentelemetry/resources"
import { NodeSDK } from "@opentelemetry/sdk-node"
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_NAMESPACE,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions"
import { PrismaInstrumentation } from "@prisma/instrumentation"
import {
  type ObservabilityServiceClient,
  OpenTelemetryProtocol,
} from "@reside/api/infra/observability.v1"
import { logger } from "./logger"
import { registerGracefulShutdown } from "./utils"

export type TelemetryInfraService = Pick<ObservabilityServiceClient, "getOpenTelemetryCredentials">

export type TelemetrySetup = {
  tracerProvider: TracerProvider | undefined
}

let setupPromise: Promise<TelemetrySetup> | undefined

/**
 * Configures OpenTelemetry tracing using credentials discovered from infra service.
 *
 * This helper is intentionally idempotent and safe to call from every replica main entrypoint.
 *
 * @param infraService The infra observability service client.
 */
export async function setupTelemetry(infraService: TelemetryInfraService): Promise<TelemetrySetup> {
  if (setupPromise) {
    return await setupPromise
  }

  setupPromise = setupTelemetryInternal(infraService).catch(error => {
    setupPromise = undefined
    throw error
  })

  return await setupPromise
}

const replicaName = process.env.REPLICA_NAME ?? "unknown"

export const tracingResource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: `replica-${replicaName}`,
  [ATTR_SERVICE_NAMESPACE]: "reside",
  [ATTR_SERVICE_VERSION]: process.env.REPLICA_IMAGE ?? "unknown",
  "reside.replica": replicaName,
  "reside.component": process.env.REPLICA_COMPONENT_NAME ?? "unknown",
})

async function setupTelemetryInternal(
  infraService: TelemetryInfraService,
): Promise<TelemetrySetup> {
  try {
    const response = await infraService.getOpenTelemetryCredentials({})

    if (!response.result) {
      logger.warn("infra returned empty OpenTelemetry credentials; tracing remains disabled")
      return {
        tracerProvider: undefined,
      }
    }

    const credentials = response.result
    if (credentials.protocol !== OpenTelemetryProtocol.GRPC) {
      logger.warn(
        { protocol: credentials.protocol },
        "unsupported OpenTelemetry protocol; tracing remains disabled",
      )
      return {
        tracerProvider: undefined,
      }
    }

    const metadata = new Metadata()
    for (const header of credentials.headers) {
      if (!header.key || !header.value) {
        continue
      }

      metadata.set(header.key, header.value)
    }

    const exporter = new OTLPTraceExporter({
      url: normalizeCollectorEndpoint(credentials.endpoint, credentials.insecure),
      metadata,
    })

    const sdk = new NodeSDK({
      traceExporter: exporter,
      instrumentations: [new PrismaInstrumentation(), new PinoInstrumentation()],
      resource: tracingResource,
    })

    sdk.start()

    const tracerProvider = trace.getTracerProvider()

    registerGracefulShutdown(async () => {
      await sdk.shutdown()
    })

    logger.info("OpenTelemetry tracing initialized")

    return {
      tracerProvider,
    }
  } catch (error) {
    logger.warn({ error }, "failed to initialize OpenTelemetry tracing")

    return {
      tracerProvider: undefined,
    }
  }
}

function normalizeCollectorEndpoint(endpoint: string, insecure: boolean): string {
  if (endpoint.startsWith("http://") || endpoint.startsWith("https://")) {
    return endpoint
  }

  return `${insecure ? "http" : "https"}://${endpoint}`
}
