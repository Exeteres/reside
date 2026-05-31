import type { DescService } from "@bufbuild/protobuf"
import {
  type Client,
  createClient as createConnectRpcClient,
  type Interceptor,
  type Transport,
} from "@connectrpc/connect"
import { createConnectTransport } from "@connectrpc/connect-node"
import { context, propagation, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api"
import { DiscoveryService } from "@reside/api/alpha/discovery.v1"
import { getReplicaName, getReplicaNamespace, getTokenForAudience } from "./kubernetes"
import { logger } from "./logger"

const DISCOVERY_CACHE_TTL_MS = 30_000
const DYNAMIC_CHANNEL_BASE_URL = "http://placeholder.invalid"
const grpcClientTracer = trace.getTracer("reside.grpc.client")

/**
 * Creates gRPC channels for the specified service endpoints using ReSide's standard configuration.
 *
 * Runtime endpoint routing is resolved dynamically by querying Alpha discovery.
 * If Alpha discovery is unavailable, channels fall back to topology endpoints.
 *
 * @param endpoints An object mapping service names to their gRPC server endpoints.
 * @returns An object mapping service names to their corresponding gRPC channels.
 */
export async function createChannels<TEndpoints extends Record<string, string>>(
  endpoints: TEndpoints,
): Promise<{ [Key in keyof TEndpoints]: Transport } & { self: Transport }> {
  logger.info("creating gRPC channels for %d endpoints", Object.keys(endpoints).length)

  const discovery = createEndpointDiscovery(endpoints)

  const entries = Object.entries(endpoints).map(([key, fallbackEndpoint]) => {
    return [
      key,
      createDynamicChannel({
        endpointName: key,
        fallbackEndpoint,
        discovery,
      }),
    ] as const
  })

  logger.info("gRPC channels created successfully")

  return {
    ...Object.fromEntries(entries),
    self: createChannel(`${getReplicaName()}.${getReplicaNamespace()}.svc.cluster.local:80`),
  } as { [Key in keyof TEndpoints]: Transport } & { self: Transport }
}

/**
 * Creates a Connect transport for the specified endpoint, configured with ReSide auth headers.
 *
 * @param endpoint The remote endpoint.
 * @returns A configured Connect transport.
 */
export function createChannel(endpoint: string): Transport {
  const baseUrl = normalizeConnectEndpoint(endpoint)

  return createConnectTransport({
    httpVersion: "1.1",
    baseUrl,
    interceptors: [createGrpcClientTracingInterceptor(), createAuthInterceptor()],
  })
}

/**
 * Creates a gRPC client for the specified service descriptor and channel, configured with ReSide auth headers.
 *
 * @param service The protobuf service descriptor.
 * @param channel The gRPC channel to connect the client to.
 * @returns A configured Connect client instance for the specified service.
 */
export function createClient<Service extends DescService>(
  service: Service,
  channel: Transport,
): Client<Service> {
  return createConnectRpcClient(service, channel)
}

function createDynamicChannel(options: {
  endpointName: string
  fallbackEndpoint: string
  discovery: EndpointDiscovery
}): Transport {
  return createConnectTransport({
    httpVersion: "1.1",
    baseUrl: DYNAMIC_CHANNEL_BASE_URL,
    interceptors: [
      createDynamicEndpointInterceptor(options),
      createGrpcClientTracingInterceptor(options.endpointName),
      createAuthInterceptor(),
    ],
  })
}

function createGrpcClientTracingInterceptor(endpointName?: string): Interceptor {
  return next => async request => {
    const requestUrl = new URL(request.url)
    const serviceName = request.service.typeName
    const methodName = request.method.name

    return await grpcClientTracer.startActiveSpan(
      `${serviceName}/${methodName}`,
      {
        kind: SpanKind.CLIENT,
      },
      async span => {
        span.setAttribute("rpc.system", "grpc")
        span.setAttribute("rpc.service", serviceName)
        span.setAttribute("rpc.method", methodName)
        span.setAttribute("server.address", requestUrl.hostname)

        if (requestUrl.port.length > 0) {
          span.setAttribute("server.port", Number(requestUrl.port))
        }

        if (endpointName) {
          span.setAttribute("reside.endpoint_name", endpointName)
        }

        const spanContext = trace.setSpan(context.active(), span)
        propagation.inject(spanContext, request.header, {
          set(carrier, key, value) {
            carrier.set(key, value)
          },
        })

        try {
          const response = await next(request)

          const grpcStatus = response.header.get("grpc-status")
          if (grpcStatus) {
            span.setAttribute("rpc.grpc.status_code", Number(grpcStatus))
          }

          return response
        } catch (error) {
          span.recordException(error as Error)
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error),
          })

          throw error
        } finally {
          span.end()
        }
      },
    )
  }
}

function createDynamicEndpointInterceptor(options: {
  endpointName: string
  fallbackEndpoint: string
  discovery: EndpointDiscovery
}): Interceptor {
  return next => async request => {
    const endpoint = await options.discovery.resolveEndpoint(
      options.endpointName,
      options.fallbackEndpoint,
    )

    const requestUrl = new URL(request.url)
    const endpointUrl = new URL(normalizeConnectEndpoint(endpoint))

    requestUrl.protocol = endpointUrl.protocol
    requestUrl.host = endpointUrl.host
    const rewrittenRequest = {
      ...request,
      url: requestUrl.toString(),
    }

    return await next(rewrittenRequest)
  }
}

function createAuthInterceptor(): Interceptor {
  return next => async request => {
    const token = await getTokenForAudience(new URL(request.url).host)
    request.header.set("authorization", `Bearer ${token}`)

    return await next(request)
  }
}

type EndpointDiscovery = {
  resolveEndpoint: (endpointName: string, fallbackEndpoint: string) => Promise<string>
}

function createEndpointDiscovery<TEndpoints extends Record<string, string>>(
  topologyEndpoints: TEndpoints,
): EndpointDiscovery {
  const alphaEndpointValue = Reflect.get(topologyEndpoints, "alpha")
  const alphaEndpoint = typeof alphaEndpointValue === "string" ? alphaEndpointValue : undefined

  let cache:
    | {
        endpoints: Record<string, string>
        expiresAt: number
      }
    | undefined

  let inFlightLoad: Promise<Record<string, string> | undefined> | undefined

  const loadEndpoints = async (): Promise<Record<string, string> | undefined> => {
    if (!alphaEndpoint) {
      return undefined
    }

    const now = Date.now()
    if (cache && cache.expiresAt > now) {
      return cache.endpoints
    }

    if (inFlightLoad) {
      return await inFlightLoad
    }

    inFlightLoad = (async () => {
      try {
        const discoveryService = createClient(DiscoveryService, createChannel(alphaEndpoint))
        const response = await discoveryService.getEffectiveEndpoints({})

        cache = {
          endpoints: response.endpoints,
          expiresAt: Date.now() + DISCOVERY_CACHE_TTL_MS,
        }

        return response.endpoints
      } catch (error) {
        logger.warn(error, "failed to load effective endpoints from alpha discovery")
        return undefined
      } finally {
        inFlightLoad = undefined
      }
    })()

    return await inFlightLoad
  }

  return {
    resolveEndpoint: async (endpointName: string, fallbackEndpoint: string): Promise<string> => {
      if (endpointName === "alpha") {
        return fallbackEndpoint
      }

      const effectiveEndpoints = await loadEndpoints()
      const discoveredEndpoint = effectiveEndpoints?.[endpointName]

      return discoveredEndpoint ?? fallbackEndpoint
    },
  }
}

function normalizeConnectEndpoint(endpoint: string): string {
  if (endpoint.startsWith("http://") || endpoint.startsWith("https://")) {
    return endpoint
  }

  return `http://${endpoint}`
}
