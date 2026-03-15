import { clientFactory, createChannel } from "@reside/api"
import {
  type CallOptions,
  type Channel,
  type Client,
  type ClientMiddlewareCall,
  type CompatServiceDefinition,
  Metadata,
} from "nice-grpc"
import { getReplicaName, getReplicaNamespace, getTokenForAudience } from "./kubernetes"
import { resolve } from "node:dns/promises"
import { logger } from "./logger"

const CNAME_WAIT_INTERVAL_MS = 5_000
const CNAME_RETRY_WARN_EVERY_ATTEMPTS = 12

/**
 * Creates gRPC channels for the specified service endpoints using ReSide's standard configuration.
 * Each endpoint is resolved by its name using CNAME records inside the current replica namespace.
 *
 * Endpoint values are intentionally ignored at runtime; they are materialized by bootstrap/e2e
 * into namespace-local ExternalName services that this resolver targets.
 *
 * @param endpoints An object mapping service names to their gRPC server endpoints.
 * @returns An object mapping service names to their corresponding gRPC channels.
 */
export async function createChannels<TEndpoints extends Record<string, string>>(
  endpoints: TEndpoints,
): Promise<{ [Key in keyof TEndpoints]: Channel } & { self: Channel }> {
  logger.info("creating gRPC channels for %d endpoints", Object.keys(endpoints).length)

  const entries = await Promise.all(
    Object.entries(endpoints).map(async ([key]) => {
      const dnsName = `${key}.${getReplicaNamespace()}.svc.cluster.local`
      const cname = await waitForServiceCname(key, dnsName)

      logger.debug('service "%s" resolved to "%s"', key, cname)

      return [key, createChannel(`${cname}:80`)]
    }),
  )

  logger.info("gRPC channels created successfully")

  return {
    ...Object.fromEntries(entries),
    self: createChannel(`${getReplicaName()}.${getReplicaNamespace()}.svc.cluster.local:80`),
  } as { [Key in keyof TEndpoints]: Channel } & { self: Channel }
}

/**
 * Creates a gRPC client for the specified service definition and channel, configured with ReSide's standard settings and authentication middleware.
 *
 * @param definition The gRPC service definition to create a client for.
 * @param channel The gRPC channel to connect the client to.
 * @returns A configured gRPC client instance for the specified service.
 */
export function createClient<Service extends CompatServiceDefinition>(
  definition: Service,
  channel: Channel,
): Client<Service> {
  async function* authMiddleware<Request, Response>(
    call: ClientMiddlewareCall<Request, Response>,
    options: CallOptions,
  ) {
    const token = await getTokenForAudience(channel.getTarget())
    const metadata = new Metadata(options.metadata)

    metadata.set("authorization", `Bearer ${token}`)

    return yield* call.next(call.request, { ...options, metadata })
  }

  return clientFactory.use(authMiddleware).create(definition, channel)
}

async function waitForServiceCname(serviceName: string, dnsName: string): Promise<string> {
  let attempt = 0

  logger.info(
    'waiting for CNAME record for service "%s" using "%s" (interval: %dms)',
    serviceName,
    dnsName,
    CNAME_WAIT_INTERVAL_MS,
  )

  while (true) {
    attempt += 1

    try {
      const names = await resolve(dnsName, "CNAME")

      if (names.length === 1) {
        const cname = names.at(0)
        if (!cname) {
          throw new Error("Single CNAME result was empty")
        }

        if (attempt > 1) {
          logger.info(
            'CNAME record for service "%s" became available after %d attempts',
            serviceName,
            attempt,
          )
        }

        return cname
      }

      if (names.length === 0) {
        throw new Error("No CNAME records returned")
      }

      throw new Error(`Multiple CNAME records returned: ${names.join(", ")}`)
    } catch (error) {
      if (attempt % CNAME_RETRY_WARN_EVERY_ATTEMPTS === 0) {
        logger.warn(
          error,
          'CNAME record for service "%s" is not ready yet, still retrying (attempt: %d)',
          serviceName,
          attempt,
        )
      } else {
        logger.debug(
          error,
          'CNAME record for service "%s" is not ready yet, retrying (attempt: %d)',
          serviceName,
          attempt,
        )
      }

      await Bun.sleep(CNAME_WAIT_INTERVAL_MS)
    }
  }
}
